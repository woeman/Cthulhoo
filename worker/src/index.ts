// The surface relay for Cthulhoo. It holds séance rooms (one Durable Object per
// sign, with WebSockets) and cult boards (one Durable Object per cult). No
// accounts: a device is known by the random mark the game makes for it.
//
//   POST /seance                  open a séance, returns { sign }
//   GET  /seance/:sign            { phase, sitters, full } or 404
//   GET  /seance/:sign/socket     the WebSocket a device sits on
//   POST /cult                    { id, name, day } found a cult, returns { sign, board }
//   GET  /cult/:sign?id=&day=     the week's board
//   POST /cult/:sign/join         { id, name, day }
//   POST /cult/:sign/dive         { id, day, depth }
//   POST /cult/:sign/leave        { id }

import { makeSign, parseSign } from '../../src/party/codes';
import { Cult, type CultReply } from './cult';
import { Seance } from './seance';

export { Cult, Seance };

export interface Env {
  SEANCE: DurableObjectNamespace<Seance>;
  CULT: DurableObjectNamespace<Cult>;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } });
const oops = (message: string, status: number) => json({ error: message }, status);

const rand = () => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
};

async function body(req: Request): Promise<Record<string, unknown>> {
  if ((Number(req.headers.get('Content-Length')) || 0) > 4096) return {};
  try {
    const v = await req.json();
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const reply = (r: CultReply) => (r.ok ? json({ board: r.board }) : oops(r.message, r.status));
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));

async function seance(req: Request, env: Env, parts: string[]): Promise<Response> {
  if (parts.length === 1) {
    if (req.method !== 'POST') return oops('Use POST to open a séance.', 405);
    for (let i = 0; i < 16; i++) {
      const sign = makeSign('seance', rand);
      if (await env.SEANCE.get(env.SEANCE.idFromName(sign)).open(sign)) return json({ sign });
    }
    return oops('Every sign is in use. Try again in a moment.', 503);
  }
  const sign = parseSign(decodeURIComponent(parts[1]), 'seance');
  if (!sign) return oops('No séance has that sign.', 404);
  const stub = env.SEANCE.get(env.SEANCE.idFromName(sign));
  if (parts[2] === 'socket') return stub.fetch(req);
  if (parts.length === 2 && req.method === 'GET') {
    const peek = await stub.peek();
    return peek ? json({ sign, ...peek }) : oops('No séance has that sign.', 404);
  }
  return oops('Nothing lives here.', 404);
}

async function cult(req: Request, env: Env, parts: string[], url: URL): Promise<Response> {
  if (parts.length === 1) {
    if (req.method !== 'POST') return oops('Use POST to found a cult.', 405);
    const b = await body(req);
    for (let i = 0; i < 16; i++) {
      const sign = makeSign('cult', rand);
      const r = await env.CULT.get(env.CULT.idFromName(sign)).found(sign, String(b.id ?? ''), String(b.name ?? ''), num(b.day));
      if (r) return r.ok ? json({ sign, board: r.board }) : oops(r.message, r.status);
    }
    return oops('Every sign is in use. Try again in a moment.', 503);
  }
  const sign = parseSign(decodeURIComponent(parts[1]), 'cult');
  if (!sign) return oops('No cult has that sign.', 404);
  const stub = env.CULT.get(env.CULT.idFromName(sign));
  if (parts.length === 2 && req.method === 'GET') return reply(await stub.board(url.searchParams.get('id') ?? '', num(url.searchParams.get('day'))));
  if (parts.length === 3 && req.method === 'POST') {
    const b = await body(req);
    const id = String(b.id ?? '');
    if (parts[2] === 'join') return reply(await stub.join(id, String(b.name ?? ''), num(b.day)));
    if (parts[2] === 'dive') return reply(await stub.dive(id, num(b.day), num(b.depth)));
    if (parts[2] === 'leave') return json({ left: await stub.leave(id) });
  }
  return oops('Nothing lives here.', 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (!parts.length || parts[0] === 'health') return json({ ok: true, relay: 'cthulhoo' });
      if (parts[0] === 'seance') return await seance(req, env, parts);
      if (parts[0] === 'cult') return await cult(req, env, parts, url);
      return oops('Nothing lives here.', 404);
    } catch (err) {
      console.error('relay error', err);
      return oops('The relay faltered. Try again.', 500);
    }
  },
} satisfies ExportedHandler<Env>;
