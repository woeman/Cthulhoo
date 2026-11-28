// Seeds a preview's census with pretend divers, then plays it on two phones and a
// desktop: the share on each reveal, the answers most given in the log, and the
// Reliquary; the questions fetched a file at a time and kept for a log read with
// no line; then the topics and the music, a class held on the desk with the
// phones in it, and a revision dive. It refuses any relay but a preview's or one
// on this machine, so pretend divers never reach the live game.
// Run by .github/workflows/preview.yml, or by hand against `wrangler dev`.
// usage: node dev/census-check.cjs <outDir>
//   env BASE   the site (required)
//       RELAY  the relay (default: the site's own address, as a preview serves both)
//       SEED   pretend divers for each day (default 40)
//       SCALE  screenshot pixel ratio (default 1)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE;
if (!BASE) {
  console.error('Set BASE to the site to check.');
  process.exit(2);
}
const RELAY = (process.env.RELAY || new URL(BASE).origin).replace(/\/+$/, '');
const relayHost = new URL(RELAY).hostname;
if (!(relayHost === '127.0.0.1' || relayHost === 'localhost' || /(^|[.-])preview([.-]|$)/.test(relayHost))) {
  console.error(`Refusing to seed ${RELAY}: pretend divers go only to a preview's relay or one on this machine.`);
  process.exit(2);
}
const SEED = Math.max(0, Number(process.env.SEED ?? 40) || 0);
const SCALE = Number(process.env.SCALE) || 1;
const OUT = process.argv[2] || 'census-check';
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);
const lines = [];
let failed = false;
const pass = (text) => { lines.push(`- ✅ ${text}`); log('PASS', text); };
const fail = (text) => { lines.push(`- ❌ ${text}`); log('FAIL', text); failed = true; };
const info = (text) => { lines.push(`- ${text}`); log('NOTE', text); };
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------ the bank, as the site was built

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
const files = [
  ...(fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).map((f) => path.join(dataDir, f)) : []),
  path.join(root, 'src/content/placeholder-bank.json'),
];
const byId = new Map();
const byText = new Map();
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const p of Array.isArray(j.prompts) ? j.prompts : []) {
    if (!byId.has(p.id)) byId.set(p.id, p);
    if (!byText.has(flat(p.text))) byText.set(flat(p.text), p);
  }
}
/** True answers from the commonest to the rarest. */
const answersFor = (text) => {
  const p = byText.get(flat(text));
  return p ? [...p.answers].sort((a, b) => a.tier - b.tier).map((a) => a.answer) : [];
};

// ------------------------------------------------------------ pretend divers

/** A small seeded generator, so seeding the same day twice sends the same answers (and the relay counts them once). */
function rng(seedText) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Most divers give the commonplace answers; a few find the rare ones; some run out of air.
const WEIGHT = { 1: 40, 2: 16, 3: 7, 4: 3, 5: 1.2, 6: 0.5 };
function pretendAnswer(prompt, rand) {
  if (rand() < 0.1) return null;
  const answers = prompt.answers.filter((a) => !a.openSecret || rand() < 0.5);
  const total = answers.reduce((s, a) => s + (WEIGHT[a.tier] ?? 1), 0);
  let pick = rand() * total;
  for (const a of answers) if ((pick -= WEIGHT[a.tier] ?? 1) <= 0) return a.answer;
  return answers[answers.length - 1].answer;
}

async function post(pathname, body) {
  const r = await fetch(RELAY + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** The day each time zone is playing and its questions, read from a dive just begun there. */
async function daysPlayed(browser) {
  const out = new Map();
  for (const timezoneId of ['Pacific/Pago_Pago', 'UTC', 'Pacific/Kiritimati']) {
    const ctx = await browser.newContext({ timezoneId, viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => localStorage.setItem('cthulhoo.v1.flag.seenHowTo', '1'));
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}?scale=1`);
      await page.getByRole('button', { name: /Begin the descent/ }).first().click({ timeout: 45000 });
      await page.waitForSelector('.prompt-screen .question', { timeout: 30000 });
      const days = await page.evaluate(() => JSON.parse(localStorage.getItem('cthulhoo.v1.days') || '{}'));
      for (const rec of Object.values(days)) if (!rec.practice && Array.isArray(rec.promptIds)) out.set(rec.day, { day: rec.day, date: rec.date, promptIds: rec.promptIds, timezoneId });
    } finally {
      await ctx.close();
    }
  }
  return [...out.values()].sort((a, b) => a.day - b.day);
}

async function seed(days) {
  let sent = 0;
  let counted = null;
  for (const d of days) {
    const jobs = [];
    for (let i = 0; i < SEED; i++) {
      for (const pid of d.promptIds) {
        const prompt = byId.get(pid);
        if (!prompt) continue;
        const answer = pretendAnswer(prompt, rng(`${d.day}|${i}|${pid}`));
        jobs.push({ id: `pretend-d${d.day}-${i}`, prompt: pid, answer });
      }
    }
    for (let k = 0; k < jobs.length; k += 25) {
      const res = await Promise.all(jobs.slice(k, k + 25).map((j) => post(`/census/${d.day}`, j)));
      for (const r of res) {
        if (r.status === 404 && /Nothing lives here/.test(r.body.error ?? '')) return { sent, missing: true };
        if (r.status !== 200) throw new Error(`the relay refused a pretend diver: ${r.status} ${JSON.stringify(r.body)}`);
        sent++;
        if (r.body.count?.prompt === d.promptIds[0]) counted = r.body.count.total;
      }
    }
    info(`Seeded day ${d.day} (${d.date}, as played in ${d.timezoneId}) with ${SEED} pretend divers; its first question now has ${counted} counted.`);
  }
  return { sent, missing: false };
}

// ------------------------------------------------------------ the phones

const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
async function device(browser, name, { desktop = false } = {}) {
  const ctx = await browser.newContext({
    ...(desktop ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }),
    deviceScaleFactor: SCALE,
    timezoneId: 'Europe/London',
  });
  await ctx.addInitScript(() => localStorage.setItem('cthulhoo.v1.flag.seenHowTo', '1'));
  const d = { name, ctx, errors: [] };
  d.open = async (url, opts) => {
    d.page = await ctx.newPage();
    d.page.on('pageerror', (e) => d.errors.push(e.message));
    d.page.on('console', (m) => m.type() === 'error' && d.errors.push(m.text()));
    await d.page.goto(url, opts);
    return d.page;
  };
  return d;
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
const until = (promise) => promise.then(() => true, () => false);
const divers = (text) => Number((/(?:today’s|first) ([\d,]+)/.exec(text)?.[1] ?? '').replace(/,/g, '')) || null;

/**
 * One whole daily dive. `pick` chooses from the true answers, commonest first.
 * Returns what each reveal's census said.
 */
async function dive(page, who, pick, shots) {
  await page.getByRole('button', { name: /Begin the descent/ }).first().click();
  const said = [];
  for (let q = 0; q < 7; q++) {
    await page.waitForSelector('.prompt-screen .question', { timeout: 30000 });
    await page.waitForSelector('input.answer:not([disabled])', { timeout: 15000 });
    await page.waitForTimeout(1200);
    const text = await page.locator('.prompt-screen .question').innerText();
    const list = answersFor(text);
    if (!list.length) throw new Error(`no answers known for "${flat(text)}"`);
    const word = pick(list, q);
    await page.fill('input.answer', word);
    await page.press('input.answer', 'Enter');
    await page.waitForSelector('.reveal-screen', { timeout: 20000 });
    // The census line is written during the descent, or as soon as the relay answers.
    await page.waitForSelector('.reveal-screen .census:not(.waiting)', { timeout: 8000 }).catch(() => {});
    // A headless browser drawing the sea in software is slow: give each read some time.
    const tier = flat(await page.locator('#reveal-title').first().textContent({ timeout: 10000 }).catch(() => ''));
    const census = flat(await page.locator('.reveal-screen .census').first().textContent({ timeout: 10000 }).catch(() => ''));
    said.push({ question: flat(text), word, tier, census });
    if (shots && (q === 0 || /^(Unspeakable|Forbidden)$/.test(tier))) {
      await page.waitForTimeout(1400);
      await shot(page, `${who}-reveal-${q + 1}`);
    }
    await page.locator('.reveal-screen .btn.primary').click();
  }
  await page.waitForSelector('.results-screen', { timeout: 30000 });
  return said;
}

/** The log of a dive: the shares beside the tiers, and one answer opened to show the census under it. */
async function readLog(page, who) {
  const shared = await until(page.waitForSelector('.dive-log .t .share', { timeout: 10000 }));
  await page.waitForTimeout(2500);
  const shares = (await page.locator('.dive-log .t').allInnerTexts()).map(flat);
  const rows = page.locator('.dive-log > li');
  let opened = null;
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i);
    await row.locator('summary').click();
    await page.waitForTimeout(300);
    if (await row.locator('.census-rows li').count()) {
      opened = { i, text: flat(await row.locator('.census-slot').innerText()), yours: await row.locator('.census-rows li.yours').count() };
      await row.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shot(page, `${who}-log`);
      break;
    }
    await row.locator('summary').click();
  }
  return { shared, shares, opened };
}

async function reliquary(page, who) {
  await page.locator('.results-screen .btn', { hasText: 'Return to the surface' }).click();
  await page.waitForSelector('.title-screen', { timeout: 20000 });
  await page.getByRole('button', { name: 'Logbook', exact: true }).click();
  const keep = page.locator('.lb-keepsake', { hasText: 'The Reliquary' });
  await keep.waitFor({ timeout: 20000 });
  const note = flat(await keep.locator('.lb-keepsake__note').innerText());
  await keep.scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  await shot(page, `${who}-logbook`);
  await keep.click();
  await page.waitForSelector('.sheet .reliquary-tally', { timeout: 10000 });
  await page.waitForTimeout(900);
  await shot(page, `${who}-reliquary`);
  const relics = (await page.locator('.sheet .relic').allInnerTexts()).map(flat);
  const told = await page.locator('.sheet .relic__census').count();
  await page.keyboard.press('Escape');
  return { note, relics, told };
}

(async () => {
  log('checking', BASE, 'with the relay at', RELAY);
  const browser = await chromium.launch({ args: ARGS });
  try {
    const health = await fetch(`${RELAY}/health`).then((r) => r.json()).catch(() => null);
    if (!health?.ok) throw new Error(`the relay at ${RELAY} did not answer`);

    // ------------------------------------------------ pretend divers for every day being played
    const days = await daysPlayed(browser);
    info(`Days being played somewhere now: ${days.map((d) => `No. ${d.day} (${d.date})`).join(', ')}.`);
    const seeded = await seed(days);
    if (seeded.missing) {
      info('This relay has no census, so there is nothing more to check here.');
      throw new Error('skip');
    }
    pass(`${seeded.sent} pretend answers were counted.`);

    // ------------------------------------------------ Wren dives for the rare answers
    const wren = await device(browser, 'Wren');
    // Every question the phone fetches from bank/, by name (the game asks for a question's answers when it needs them).
    const banked = new Set();
    wren.ctx.on('response', (r) => {
      const m = /\/bank\/([a-z0-9-]+)\.json(\?|$)/.exec(r.url());
      if (m && r.ok()) banked.add(m[1]);
    });
    const p = await wren.open(`${BASE}?scale=2`);
    await p.waitForSelector('.title-screen', { timeout: 45000 });
    await p.waitForTimeout(1500);
    // Rarest on every other question, so the Reliquary has something to keep.
    const a = await dive(p, 'wren', (list, q) => (q % 2 === 0 ? list[list.length - 1] : list[0]), true);
    const good = a.filter((x) => /said it\.$|found an answer\.$/.test(x.census));
    if (good.length === a.length) pass(`Every reveal tells the share of today's divers: ${a.map((x) => `${x.word} (${x.tier}): "${x.census}"`).join('; ')}`);
    else fail(`Some reveals had no share: ${a.map((x) => `${x.word} (${x.tier}): "${x.census || 'nothing'}"`).join('; ')}`);
    const log1 = await readLog(p, 'wren');
    if (log1.shared) pass(`The log shows each share beside its tier: ${log1.shares.join(' | ')}`);
    else fail(`The log showed no shares: ${log1.shares.join(' | ')}`);
    if (log1.opened) pass(`Opening answer ${log1.opened.i + 1} shows what today's divers said${log1.opened.yours ? ', with Wren’s own marked' : ''}: ${log1.opened.text.slice(0, 220)}`);
    else fail('No answer in the log showed what today’s divers said.');
    const r1 = await reliquary(p, 'wren');
    if (r1.relics.length) pass(`The Reliquary keeps ${r1.relics.length} (${r1.note}), ${r1.told} with their share told. First: ${r1.relics[0].slice(0, 200)}`);
    else fail(`The Reliquary was empty (${r1.note}) after Wren's rare answers.`);
    // ------------------------------------------------ the bank, a question at a time
    // The script holds no answers: each question's are a file in bank/, fetched when needed and kept
    // by the browser, so a dive begun can be finished, and its log read, with no line to the surface.
    try {
      if (banked.size >= 7) pass(`Wren's phone fetched its questions' answers as files of their own: ${banked.size} from bank/.`);
      else fail(`Wren's phone fetched only ${banked.size} questions from bank/ for a dive of seven.`);
      const kept = await p.evaluate(async () => (navigator.serviceWorker && navigator.serviceWorker.controller ? (await (await caches.open('cthulhoo-bank')).keys()).length : -1));
      if (kept < 0) info('No service worker has this page (the game registers one only over https), so the questions kept and a log read with no line were not checked here.');
      else {
        if (kept >= 7) pass(`The browser kept ${kept} questions for a dive with no line to the surface.`);
        else fail(`The browser kept only ${kept} questions.`);
        const heard = wren.errors.length;
        // The game is shut and opened again with no line, as a phone's is between visits. A new tab, not a reload:
        // the old one, still drawing the sea in software, can keep a slow machine from turning the page for a minute.
        await p.close().catch(() => {});
        await wren.ctx.setOffline(true);
        const began = Date.now();
        const took = () => `${((Date.now() - began) / 1000).toFixed(1)} s`;
        let at = 'opening the game';
        try {
          const o = await wren.open(`${BASE}?scale=2`, { waitUntil: 'commit', timeout: 90000 });
          at = `waiting for the title (the page came after ${took()})`;
          await o.waitForSelector('.title-screen', { timeout: 90000 });
          at = `opening the log (the title came after ${took()})`;
          await o.getByRole('button', { name: 'Read your log' }).click();
          await o.waitForSelector('.dive-log > li', { timeout: 45000 });
          await o.locator('.dive-log > li summary').first().click();
          await o.waitForTimeout(400);
          const more = flat(await o.locator('.dive-log > li .more').first().innerText());
          if (/What everyone said|Unspeakable answers/.test(more)) pass(`With no line at all the game opens and the log is read again, answers and all (${took()}): ${more.slice(0, 160)}`);
          else fail(`With no line, the log had no answers to show: "${more.slice(0, 160)}"`);
        } catch (e) {
          throw new Error(`with no line, ${at}: ${e.message.split('\n')[0]}`);
        } finally {
          await wren.ctx.setOffline(false);
          // What could not be fetched with no line (the music, the census) is no fault; anything else still counts.
          wren.errors = [...wren.errors.slice(0, heard), ...wren.errors.slice(heard).filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|Load failed/i.test(e))];
        }
      }
    } catch (e) {
      fail(`The check of the bank fetched a question at a time stopped: ${e.message.split('\n')[0]}`);
    }

    // One phone at a time: a browser drawing the sea in software is slow enough already.
    const wrenErrors = [...wren.errors];
    await wren.ctx.close();
    wren.errors = wrenErrors;

    // ------------------------------------------------ Bram dives too, and is counted as one more
    const bram = await device(browser, 'Bram');
    const b = await bram.open(`${BASE}?scale=1`);
    await b.waitForSelector('.title-screen', { timeout: 45000 });
    const bSaid = await dive(b, 'bram', (list) => list[0], false);
    const before = divers(a[0].census);
    const after = divers(bSaid[0].census);
    if (a[0].question !== bSaid[0].question) info(`Midnight came between the two dives (Bram was asked “${bSaid[0].question}”), so their counts are not compared.`);
    else if (before && after === before + 1) pass(`Bram, diving after Wren, is counted as one more: ${before} divers, then ${after}.`);
    else fail(`Bram's count did not follow Wren's: "${a[0].census}", then "${bSaid[0].census}".`);
    const log2 = await readLog(b, 'bram');
    if (!log2.shared) fail('Bram’s log showed no shares.');
    const r2 = await reliquary(b, 'bram');
    info(`Bram gave only commonplace answers, so the Reliquary says: "${r2.note}" (${r2.relics.length} kept).`);

    // ------------------------------------------------ the desktop, opening the log Wren left
    const desk = await device(browser, 'Desk', { desktop: true });
    const d = await desk.open(`${BASE}?scale=1`);
    await d.waitForSelector('.title-screen', { timeout: 45000 });
    await d.waitForTimeout(1500);
    await shot(d, 'desk-title');

    // ------------------------------------------------ topics, the class packs and the music
    const music = [];
    d.on('response', (r) => r.url().includes('/music/') && music.push(`${r.url().split('/').pop()} ${r.status()}`));
    try {
      await d.locator('.mode-btn', { hasText: 'Charted Waters' }).click();
      await d.waitForSelector('.sheet .tp-chip', { timeout: 20000 });
      // The class packs arrive a moment after the daily topics.
      await d.waitForFunction(() => document.querySelectorAll('.sheet .tp-group').length > 1, null, { timeout: 15000 }).catch(() => {});
      const groups = (await d.locator('.sheet .tp-group-k').allInnerTexts()).map(flat);
      const chips = (await d.locator('.sheet .tp-group .tp-chip').allInnerTexts()).map(flat);
      await shot(d, 'desk-topics');
      if (groups.length > 1) pass(`Charted Waters offers ${chips.length} topics under ${groups.join(', ')}: ${chips.join(' | ')}`);
      else info(`Charted Waters shows the daily topics and no class packs (none are in this branch): ${chips.join(' | ')}`);
      // That click was the first: the music may begin, and its first track is asked for.
      await d.waitForTimeout(2500);
      if (music.some((m) => / (200|206)$/.test(m))) pass(`The music begins on the first click: ${music.join(', ')}.`);
      else fail(`No music was fetched after the first click: ${music.join(', ') || 'nothing asked for'}.`);
      await d.keyboard.press('Escape');
    } catch (e) {
      await shot(d, 'desk-topics-fail');
      fail(`Charted Waters did not open: ${e.message.split('\n')[0]}`);
    }

    // ------------------------------------------------ the Convocation: a class held on the desk, the two phones in it
    try {
      await d.waitForSelector('.title-screen', { timeout: 15000 });
      await d.locator('.mode-btn', { hasText: 'The Convocation' }).click();
      await d.click('[data-way="hold"]');
      await d.waitForSelector('.cv-host-lobby', { timeout: 45000 });
      const sign = flat(await d.textContent('.sc-bar-sign'));
      // Wren's phone was put away after her dive: a third diver, Ada, comes in by the link beside Bram.
      const ada = await device(browser, 'Ada');
      const link = `${BASE}?scale=1&class=${sign}`;
      // Three pages drawing the sea in software load slowly on a small runner: wait for the join form, not for the whole page.
      const slow = { waitUntil: 'commit', timeout: 120000 };
      await ada.open(link, slow);
      await bram.page.goto(link, slow);
      for (const dev of [ada, bram]) {
        await dev.page.waitForSelector('.cv-entry .sc-join', { timeout: 120000 });
        await dev.page.fill('.sc-join input[name="diver-name"]', dev.name);
        await dev.page.click('.sc-join button[type="submit"]');
        await dev.page.waitForSelector('.cv-diver-lobby', { timeout: 45000 });
      }
      await d.waitForFunction(() => document.querySelectorAll('.cv-diver').length === 2, null, { timeout: 20000 });
      await shot(d, 'class-host-lobby');
      await shot(ada.page, 'class-diver-lobby');
      await d.click('.cv-begin');
      await d.waitForSelector('.cv-host-ask', { timeout: 45000 });
      const q = flat(await d.textContent('.cv-hq-text'));
      const answers = answersFor(q);
      if (!answers.length) throw new Error(`no answers are known here for "${q}"`);
      await shot(d, 'class-host-ask');
      for (const [dev, a] of [[ada, answers[0]], [bram, answers[answers.length - 1]]]) {
        await dev.page.waitForSelector('.cv-ask input.answer', { timeout: 45000 });
        await dev.page.fill('.cv-ask input.answer', a);
        await dev.page.press('.cv-ask input.answer', 'Enter');
      }
      // Everyone has answered, so the question closes by itself.
      await d.waitForSelector('.cv-host-reveal', { timeout: 45000 });
      await bram.page.waitForSelector('.cv-reveal', { timeout: 20000 });
      await d.waitForTimeout(800);
      await shot(d, 'class-host-reveal');
      await shot(bram.page, 'class-diver-reveal');
      const said = flat(await d.textContent('.cv-hr-said .cv-answers'));
      const mine = flat(await bram.page.textContent('.cv-yours'));
      pass(`A class was held at ${sign}: the desk asked "${q}", the two phones joined by its link and answered, and the answers surfaced: ${said.slice(0, 220)}`);
      if (/\+[\d,]+ m/.test(mine)) pass(`Bram's phone shows his own answer and what it earned: ${mine.slice(0, 160)}`);
      else fail(`Bram's phone does not show what his answer earned: "${mine.slice(0, 160)}"`);
      // The host closes the class: it ends for the phones too.
      await d.click('.sc-back');
      await d.locator('.sc-confirm .btn.primary').click();
      await d.waitForSelector('.title-screen', { timeout: 20000 });
      await bram.page.waitForSelector('.cv-end', { timeout: 20000 });
      pass('The host closed the class, and the phones were told it had surfaced.');
      if (ada.errors.length) fail(`Ada's browser logged errors: ${[...new Set(ada.errors)].slice(0, 5).join(' | ')}`);
      await ada.ctx.close();
    } catch (e) {
      await shot(d, 'class-fail-host');
      if (bram.page) await shot(bram.page, 'class-fail-diver');
      fail(`The Convocation stopped: ${e.message.split('\n')[0]}`);
    }

    // ------------------------------------------------ a revision dive: one class pack, sat alone on the desk
    try {
      const packsDir = path.join(root, 'packs');
      const indexFile = path.join(packsDir, 'index.json');
      const index = fs.existsSync(indexFile) ? (JSON.parse(fs.readFileSync(indexFile, 'utf8')).packs ?? []) : [];
      if (!index.length) info('No class packs are in this branch, so no revision dive was made.');
      else {
        // Whatever the class left on the desk, the dive begins from a fresh title.
        const slow = { waitUntil: 'commit', timeout: 120000 };
        await d.goto(`${BASE}?scale=1`, slow);
        await d.waitForSelector('.title-screen', { timeout: 120000 });
        await d.locator('.mode-btn', { hasText: 'Charted Waters' }).click();
        await d.locator('.sheet button', { hasText: 'Revise a class pack' }).click();
        await d.waitForSelector('.rv-shelf .rv-pack', { timeout: 45000 });
        const shelf = (await d.locator('.rv-pack-name').allInnerTexts()).map(flat);
        await shot(d, 'revise-shelf');
        const at = shelf.findIndex((name) => index.some((p) => p.name === name));
        const pack = index.find((p) => p.name === shelf[at]);
        if (!pack) throw new Error(`the shelf (${shelf.join(', ') || 'empty'}) holds none of the packs of this branch`);
        await d.locator('.rv-pack').nth(at).click();
        await d.waitForSelector('.rv-pack-scene .rv-q', { timeout: 45000 });
        // A question in today's dive is held back until the dive is made: sit the first that is open.
        const row = d.locator('.rv-q:not([disabled])').first();
        const q = flat(await row.locator('.rv-q-text').innerText());
        const prompt = JSON.parse(fs.readFileSync(path.join(packsDir, pack.file), 'utf8')).prompts.find((p) => flat(p.text) === q);
        if (!prompt) throw new Error(`"${q}" is not in packs/${pack.file}`);
        const sorted = [...prompt.answers].sort((a, b) => a.tier - b.tier);
        const give = [sorted[0], sorted[sorted.length - 1]];
        await row.click();
        await d.waitForSelector('.rv-ask input.answer', { timeout: 45000 });
        for (const [i, a] of give.entries()) {
          await d.fill('.rv-ask input.answer', a.answer);
          await d.press('.rv-ask input.answer', 'Enter');
          await d.waitForFunction((n) => document.querySelectorAll('.rv-ask .rv-named .cv-named-a').length === n, i + 1, { timeout: 15000 });
        }
        const depth = flat(await d.textContent('.rv-ask .rv-depth'));
        await shot(d, 'revise-ask');
        await d.click('.rv-done');
        await d.waitForSelector('.rv-result', { timeout: 20000 });
        await d.waitForTimeout(600);
        await shot(d, 'revise-missed');
        const count = flat(await d.textContent('.rv-result .rv-count'));
        const tiers = await d.locator('.rv-tier').count();
        const missed = (await d.locator('.rv-chips.is-missed .cv-named-a').allInnerTexts()).map(flat);
        if (parseInt(depth.replace(/\D/g, ''), 10) > 0 && tiers && missed.length) pass(`A revision dive on ${pack.name}: "${q}" took ${give.map((a) => a.answer).join(' and ')} down to ${depth} (${count}), then showed what was missed in ${tiers} tiers, beginning ${missed.slice(0, 5).join(', ')}.`);
        else fail(`The revision dive on ${pack.name} came up short: depth "${depth}", ${tiers} tiers and ${missed.length} missed answers shown for "${q}".`);
        // What was reached is kept on the device: the pack, opened again by its own link, remembers it.
        await d.goto(`${BASE}?scale=1&revise=${pack.id}`, slow);
        await d.waitForSelector('.rv-pack-scene .rv-q', { timeout: 120000 });
        const kept = flat(await d.textContent('.rv-progress-line'));
        if (/of the way down/.test(kept)) pass(`Opened again by its link (?revise=${pack.id}), the pack remembers the sitting: "${kept}".`);
        else fail(`Opened again by its link (?revise=${pack.id}), the pack has forgotten the sitting: "${kept}".`);
      }
    } catch (e) {
      await shot(d, 'revise-fail');
      fail(`The revision dive stopped: ${e.message.split('\n')[0]}`);
    }
    for (const dev of [wren, bram, desk]) {
      const errs = [...new Set(dev.errors)];
      if (errs.length) fail(`${dev.name}'s browser logged errors: ${errs.slice(0, 5).join(' | ')}`);
    }
    if (![wren, bram, desk].some((dev) => dev.errors.length)) pass('No browser logged an error.');
  } catch (e) {
    if (e.message !== 'skip') fail(`The check stopped: ${e.message.split('\n')[0]}`);
  }
  await browser.close();
  const report = `## The census and the Reliquary\n\n${BASE}\n\nThe shares here come from ${SEED} pretend divers a day, counted only by this preview's own relay.\n\n${lines.join('\n')}\n`;
  console.log('\n' + report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  process.exit(failed ? 1 : 0);
})();
