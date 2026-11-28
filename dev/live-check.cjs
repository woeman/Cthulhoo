// Plays the published game once, the way visitors will: the title on a phone and a
// desktop, a whole daily dive, the riddle, and, when the site was built with the
// relay, a cult joined by link and a séance between two phones.
// Run by .github/workflows/live-check.yml.
// usage: node dev/live-check.cjs <outDir>   env BASE (default https://woeman.github.io/Cthulhoo/)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'https://woeman.github.io/Cthulhoo/';
const OUT = process.argv[2] || 'live-check';
fs.mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`, ...a);
const lines = [];
let failed = false;
const pass = (text) => { lines.push(`- ✅ ${text}`); log('PASS', text); };
const fail = (text) => { lines.push(`- ❌ ${text}`); log('FAIL', text); failed = true; };
const info = (text) => { lines.push(`- ${text}`); log('NOTE', text); };
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Every prompt the site could have been built with, by its text: the question
// bank in data/ when it is there, and the placeholders the game falls back to.
const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'data');
const files = [
  ...(fs.existsSync(dataDir) ? fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).map((f) => path.join(dataDir, f)) : []),
  path.join(root, 'src/content/placeholder-bank.json'),
];
const byText = new Map();
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const p of Array.isArray(j.prompts) ? j.prompts : []) if (!byText.has(flat(p.text))) byText.set(flat(p.text), p);
}
/** True answers from the commonest to the rarest. */
const answersFor = (text) => {
  const p = byText.get(flat(text));
  return p ? [...p.answers].sort((a, b) => a.tier - b.tier).map((a) => a.answer) : [];
};

const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
async function device(browser, name, { desktop = false } = {}) {
  const ctx = await browser.newContext(
    desktop ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  );
  await ctx.addInitScript((n) => {
    if (!localStorage.getItem('cthulhoo.v1.sitterName')) localStorage.setItem('cthulhoo.v1.sitterName', n);
  }, name);
  // The live census counts real divers only: this check's answers never reach it. The
  // game takes an empty answer as "no census today" (a failed request would log an error).
  await ctx.route(/\/census\//, (route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    return route.request().method() === 'OPTIONS'
      ? route.fulfill({ status: 204, headers: cors })
      : route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{}' });
  });
  const d = { name, ctx, errors: [] };
  d.open = async (url) => {
    d.page = await ctx.newPage();
    d.page.on('pageerror', (e) => d.errors.push(e.message));
    d.page.on('console', (m) => m.type() === 'error' && d.errors.push(m.text()));
    await d.page.goto(url);
    return d.page;
  };
  return d;
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
const until = (promise) => promise.then(() => true, () => false);

async function dailyDive(page) {
  await page.getByRole('button', { name: /Begin the descent/ }).first().click();
  // A first visit shows how to play first, with its own button.
  const howTo = page.locator('.sheet').getByRole('button', { name: /Begin the descent/ });
  if (await until(howTo.waitFor({ timeout: 4000 }))) {
    await shot(page, '02-phone-how-to');
    await howTo.click();
  }
  const said = [];
  for (let q = 0; q < 7; q++) {
    await page.waitForSelector('.prompt-screen .question', { timeout: 30000 });
    await page.waitForSelector('input.answer:not([disabled])', { timeout: 15000 });
    await page.waitForTimeout(1500);
    const text = await page.locator('.prompt-screen .question').innerText();
    const list = answersFor(text);
    if (!list.length) throw new Error(`no answers known for the question "${flat(text)}"`);
    const word = list[(q * 3) % list.length];
    if (q === 0) await shot(page, '03-phone-question');
    await page.fill('input.answer', word);
    await page.press('input.answer', 'Enter');
    await page.waitForSelector('.reveal-screen', { timeout: 20000 });
    const tier = flat(await page.textContent('#reveal-title'));
    said.push(`${word} (${tier})`);
    if (q === 0) {
      await page.waitForTimeout(1200);
      await shot(page, '04-phone-reveal');
    }
    await page.locator('.reveal-screen .btn.primary').click();
  }
  await page.waitForSelector('.results-screen', { timeout: 30000 });
  await page.waitForTimeout(3500);
  await shot(page, '05-phone-results');
  return { said, total: flat(await page.locator('#total').textContent().catch(() => '')) };
}

async function riddle(page) {
  await page.locator('.mode-btn', { hasText: 'Whispering' }).click();
  await page.waitForSelector('.riddle-screen', { timeout: 20000 });
  await page.waitForTimeout(2500);
  await shot(page, '06-phone-riddle');
  return flat(await page.locator('.riddle-screen').innerText()).slice(0, 120);
}

async function foundCult(page) {
  await page.getByRole('button', { name: 'Logbook', exact: true }).click();
  await page.getByRole('button', { name: /The Cult/ }).first().click();
  await page.click('.cult-found');
  await page.waitForSelector('.cult-head', { timeout: 20000 });
  const sign = flat(await page.textContent('.cult-head .cult-sign')).match(/[A-Z]+-\d+/)[0];
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  return sign;
}

/** Leave the cult from its sheet; when the last member leaves, the relay forgets it. */
async function leaveCult(page) {
  await page.getByRole('button', { name: 'Logbook', exact: true }).click();
  await page.getByRole('button', { name: /The Cult/ }).first().click();
  await page.waitForSelector('.cult-board', { timeout: 20000 });
  await page.locator('.cult-leave button', { hasText: 'Leave the cult' }).click();
  await page.locator('.cult-leave button', { hasText: /^Leave$/ }).click();
  await page.waitForSelector('.cult-found', { timeout: 20000 });
  await page.keyboard.press('Escape');
}

async function seance(m, s, sign) {
  // The medium holds, the sitter comes in by the link.
  await s.waitForSelector('form.sc-join:not([hidden])', { timeout: 20000 });
  await s.click('form.sc-join button[type="submit"]');
  await s.waitForSelector('.sc-lobby', { timeout: 20000 });
  await m.waitForFunction(() => document.querySelectorAll('.sc-lobby .sc-sitter').length === 2, null, { timeout: 20000 });
  await shot(m, '08-seance-lobby');
  await m.click('.sc-lobby .sc-config:not(.sc-topics) fieldset:nth-of-type(1) label:has-text("3")');
  await m.click('.sc-lobby .sc-config:not(.sc-topics) fieldset:nth-of-type(2) label:has-text("20")');
  await m.waitForTimeout(500);
  await m.click('button:has-text("Light the first candle")');
  const reveals = [];
  for (let c = 0; c < 3; c++) {
    const at = (p) => p.waitForSelector('.sc-candle-scene input.answer:not([disabled])', { timeout: 30000 });
    await at(m);
    await at(s);
    await m.waitForTimeout(1200);
    const list = answersFor(await m.textContent('.sc-candle-scene h2'));
    if (!list.length) throw new Error('no answers known for a séance question');
    if (c === 0) await shot(m, '09-seance-candle');
    for (const [p, word] of [[m, list[list.length - 1]], [s, list[0]]]) {
      await p.fill('input.answer', word);
      await p.press('input.answer', 'Enter');
      await p.waitForSelector('.sc-sealed, .sc-reveal', { timeout: 15000 });
    }
    await m.waitForSelector('.sc-reveal .sc-actions:not(.is-sunk) button', { timeout: 40000 });
    await m.waitForTimeout(800);
    reveals.push((await m.locator('.sc-voice').allInnerTexts()).map(flat).join(' / '));
    if (c === 0) await shot(m, '10-seance-reveal');
    await m.click('.sc-reveal .sc-actions button');
  }
  await m.waitForSelector('.sc-end', { timeout: 20000 });
  await s.waitForSelector('.sc-end', { timeout: 20000 });
  await m.waitForTimeout(1500);
  await shot(m, '11-seance-end');
  return { reveals, herald: flat(await m.textContent('.sc-herald-name')), sitterSees: flat(await s.textContent('.sc-herald-name')) };
}

(async () => {
  log('checking', BASE);
  const browser = await chromium.launch({ args: ARGS });
  const wren = await device(browser, 'Wren');
  const bram = await device(browser, 'Bram');
  const desk = await device(browser, 'Desk', { desktop: true });
  try {
    // ------------------------------------------------ a phone, as a first visit
    const p = await wren.open(BASE);
    if (!(await until(p.waitForSelector('.title-screen', { timeout: 45000 })))) {
      await shot(p, '01-phone-title');
      fail(`The title did not appear on a phone: ${flat(await p.locator('body').innerText().catch(() => '')).slice(0, 200)}`);
      throw new Error('no title');
    }
    await p.waitForTimeout(3000);
    await shot(p, '01-phone-title');
    const modes = (await p.locator('.mode-btn').allInnerTexts()).map(flat);
    pass(`The title loads on a phone (390×844). Modes: ${modes.join(' | ')}`);
    const relay = modes.some((t) => /join with a sign/i.test(t));
    const webgl = await p.evaluate(() => !document.documentElement.classList.contains('no-webgl'));
    info(webgl ? 'The engraved sea is drawn (WebGL works).' : 'This browser had no WebGL, so the plain fallback was shown.');
    info(relay ? 'The site was built with the relay, so séances across phones and the Cult are on.' : 'The site was built without the relay, so the Séance is pass-and-play only and the Cult is closed.');

    // ------------------------------------------------ the Cult, before the dive so the dive is posted to it
    let cult = null;
    if (relay) {
      cult = await foundCult(p).catch(async (e) => {
        await shot(p, '07-cult-fail');
        fail(`Founding a cult failed: ${e.message.split('\n')[0]}`);
        return null;
      });
      if (cult) pass(`Wren founded the cult ${cult}.`);
      await p.goto(BASE);
      await p.waitForSelector('.title-screen', { timeout: 30000 });
      await p.waitForTimeout(1500);
    }

    // ------------------------------------------------ a whole daily dive
    try {
      const dive = await dailyDive(p);
      pass(`A whole daily dive plays: ${dive.said.join(', ')}. Total: ${dive.total || '(not read)'}`);
    } catch (e) {
      await shot(p, '05-phone-dive-fail');
      fail(`The daily dive stopped: ${e.message.split('\n')[0]}`);
    }

    // ------------------------------------------------ the riddle
    await p.goto(BASE + '?scale=1');
    await p.waitForSelector('.title-screen', { timeout: 30000 });
    await p.waitForTimeout(1500);
    try {
      pass(`The riddle opens: ${await riddle(p)}`);
    } catch (e) {
      await shot(p, '06-phone-riddle-fail');
      fail(`The riddle did not open: ${e.message.split('\n')[0]}`);
    }

    // ------------------------------------------------ topics, the class packs and the music
    // Run from a branch, this script may be ahead of the live game: what is not live yet is noted, not failed.
    const ahead = !!process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== 'main';
    const missing = (text) => (ahead ? info(`${text} (not live yet: this check ran from the branch ${process.env.GITHUB_REF_NAME})`) : fail(text));
    await p.goto(BASE + '?scale=1');
    await p.waitForSelector('.title-screen', { timeout: 30000 });
    await p.waitForTimeout(1000);
    if (!(await p.locator('.mode-btn', { hasText: 'Charted Waters' }).count())) {
      missing('The title has no Charted Waters.');
    } else {
      try {
        await p.locator('.mode-btn', { hasText: 'Charted Waters' }).click();
        await p.waitForSelector('.sheet .tp-chip', { timeout: 20000 });
        // The class packs arrive a moment after the daily topics.
        await p.waitForFunction(() => document.querySelectorAll('.sheet .tp-group').length > 1, null, { timeout: 15000 }).catch(() => {});
        const groups = (await p.locator('.sheet .tp-group-k').allInnerTexts()).map(flat);
        const chips = (await p.locator('.sheet .tp-group .tp-chip').allInnerTexts()).map(flat);
        await shot(p, '08-topics');
        if (groups.length > 1) pass(`Charted Waters offers ${chips.length} topics under ${groups.join(', ')}.`);
        else missing(`Charted Waters shows no class packs, only: ${chips.join(' | ')}`);
        await p.keyboard.press('Escape');
      } catch (e) {
        await shot(p, '08-topics-fail');
        fail(`Charted Waters did not open: ${e.message.split('\n')[0]}`);
      }
    }
    for (const [what, file, type] of [['The list of class packs', 'packs/index.json', /json/], ['The music', 'music/surface-a.mp3', /audio/]]) {
      const res = await fetch(new URL(file, BASE), { headers: { Range: 'bytes=0-1023' } }).catch(() => null);
      const kind = res?.headers.get('content-type') ?? '';
      if (res && res.status < 300 && type.test(kind)) pass(`${what} is published (${file}: ${res.status}, ${kind}).`);
      else missing(`${what} is not published: ${file} answered ${res ? `${res.status} ${kind}` : 'nothing'}.`);
    }

    // ------------------------------------------------ the Cult board seen by a friend through the link
    if (relay && cult) {
      const b = await bram.open(`${BASE}?scale=1&cult=${cult}`);
      try {
        await b.waitForSelector('.sheet .cult-join', { timeout: 30000 });
        await b.click('.cult-join-btn');
        await b.waitForSelector('.cult-board', { timeout: 20000 });
        await b.waitForTimeout(1200);
        await shot(b, '07-cult-board');
        const board = flat(await b.locator('.cult-board').innerText());
        if (/Wren/.test(board)) pass(`Bram joined ${cult} by its link and sees the board: ${board.slice(0, 160)}`);
        else fail(`Bram joined ${cult}, but Wren is not on the board: ${board.slice(0, 160)}`);
        await b.keyboard.press('Escape');
      } catch (e) {
        await shot(b, '07-cult-fail');
        fail(`Joining the cult by its link failed: ${e.message.split('\n')[0]}`);
      }
    }

    // ------------------------------------------------ a séance between the two phones
    if (relay) {
      await p.goto(BASE + '?scale=1');
      await p.waitForSelector('.title-screen', { timeout: 30000 });
      await p.locator('.mode-btn', { hasText: 'The Séance' }).click();
      await p.click('[data-way="hold"]');
      try {
        await p.waitForSelector('.sc-lobby', { timeout: 30000 });
        const sign = flat(await p.textContent('.sc-bar-sign'));
        pass(`Wren holds a séance at ${sign}.`);
        const s = bram.page ? bram.page : await bram.open(BASE);
        await s.goto(`${BASE}?scale=1&seance=${sign}`);
        const r = await seance(p, s, sign);
        pass(`Bram came in by the link and three candles were played. ${r.reveals.map((x, i) => `Candle ${i + 1}: ${x}`).join('; ')}`);
        if (r.herald && r.herald === r.sitterSees) pass(`Both phones agree the Herald of the Deep is ${r.herald}.`);
        else fail(`The phones disagree on the Herald: "${r.herald}" and "${r.sitterSees}".`);
        // Both rise from the séance, back to the title.
        for (const page of [p, s]) {
          await page.click('.sc-back');
          await page.waitForSelector('.title-screen', { timeout: 15000 });
        }
      } catch (e) {
        await shot(p, '12-seance-fail-medium');
        if (bram.page) await shot(bram.page, '12-seance-fail-sitter');
        fail(`The séance stopped: ${e.message.split('\n')[0]}`);
      }
    }

    // ------------------------------------------------ tidy up: both leave the cult, so the relay forgets it
    if (relay && cult && bram.page) {
      try {
        for (const page of [bram.page, p]) {
          if (!(await page.locator('.title-screen').count())) {
            await page.goto(BASE + '?scale=1');
            await page.waitForSelector('.title-screen, .seance-screen', { timeout: 30000 });
            if (await page.locator('.seance-screen').count()) {
              await page.click('.sc-back');
              await page.waitForSelector('.title-screen', { timeout: 15000 });
            }
          }
          await leaveCult(page);
        }
        // A third phone tries the sign; the relay's "no such cult" is a 404 the browser logs, so its errors are not counted.
        const probe = await device(browser, 'Probe');
        const gone = await probe.open(`${BASE}?scale=1&cult=${cult}`);
        await gone.waitForSelector('.sheet .cult-join', { timeout: 30000 });
        await gone.click('.cult-join-btn');
        const said = await gone
          .waitForFunction(() => /No cult has that sign/i.test(document.querySelector('.sheet')?.textContent ?? ''), null, { timeout: 15000 })
          .then(() => true, () => false);
        if (said) pass(`Both left ${cult}, and the relay has forgotten it.`);
        else fail(`Both left ${cult}, but its sign still opens a cult.`);
      } catch (e) {
        fail(`Leaving the cult failed: ${e.message.split('\n')[0]}`);
      }
    }

    // ------------------------------------------------ a desktop
    const d = await desk.open(BASE);
    if (await until(d.waitForSelector('.title-screen', { timeout: 45000 }))) {
      await d.waitForTimeout(3000);
      await shot(d, '13-desktop-title');
      pass('The title loads on a desktop (1280×800).');
    } else {
      await shot(d, '13-desktop-title');
      fail('The title did not appear on a desktop.');
    }
  } catch (e) {
    if (e.message !== 'no title') fail(`The check itself broke: ${e.message.split('\n')[0]}`);
  }

  for (const dev of [wren, bram, desk]) {
    const errs = [...new Set(dev.errors)];
    if (errs.length) fail(`${dev.name}'s browser logged errors: ${errs.slice(0, 5).join(' | ')}`);
  }
  if (![wren, bram, desk].some((dev) => dev.errors.length)) pass('No browser logged an error.');
  await browser.close();
  const report = `## The live game\n\n${BASE}\n\n${lines.join('\n')}\n`;
  console.log('\n' + report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  process.exit(failed ? 1 : 0);
})();
