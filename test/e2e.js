// End-to-end: load the built extension into Chromium, point it at a local echo server
// and check the headers the server really receives (and the browser really sees).
// Usage: node test/e2e.js   (env CHROME=/path/to/chrome, SHOTS=/dir to save screenshots)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const assert = require('assert');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const built = path.join(root, 'dist/extension');
const CHROME = process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome');
const SHOTS = process.env.SHOTS || '';

// Echo server: /echo returns the request headers it received as JSON.
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url.startsWith('/nocors')) {
        // No CORS headers at all; answers preflights with an empty 204.
        res.writeHead(req.method === 'OPTIONS' ? 204 : 200, req.method === 'OPTIONS' ? {} : { 'content-type': 'application/json' });
        res.end(req.method === 'OPTIONS' ? '' : JSON.stringify({ ok: true, h: req.headers['x-custom'] || null }));
      } else if (req.url.startsWith('/echo')) {
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify(req.headers));
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><title>page</title><h1>test page</h1>');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// A copy of the build with host access pre-granted, because a test cannot click
// Chrome's permission prompt. The shipped build asks at run time instead.
function grantedCopy(hosts = ['<all_urls>']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-ext-'));
  fs.cpSync(built, dir, { recursive: true });
  const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  mf.host_permissions = hosts;
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(mf));
  return dir;
}

async function launch(extDir) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-prof-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  return { ctx, sw, id };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(150);
  }
  throw new Error('timed out waiting for ' + what + ' (last: ' + JSON.stringify(last) + ')');
}

async function echoVia(page, url) {
  await page.goto(url);
  return JSON.parse(await page.locator('body').innerText());
}
async function fetchVia(page, url) {
  return page.evaluate(async (u) => {
    const r = await fetch(u);
    return { body: await r.json(), resp: Object.fromEntries(r.headers.entries()) };
  }, url);
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const A = `http://127.0.0.1:${port}`, B = `http://localhost:${port}`;
  let passed = 0;
  const ok = (name) => { passed++; console.log('ok -', name); };

  // ---- 1. Shipped build, no host access granted: nothing is changed, banner asks.
  {
    const { ctx, id } = await launch(built);
    const ui = await ctx.newPage();
    await ui.goto(`chrome-extension://${id}/popup.html?page=1`);
    await ui.locator('input.name').first().fill('X-HeaderDial');
    await ui.locator('input.value').first().fill('on');
    await until(() => ui.evaluate(async () => ((await chrome.storage.local.get('status')).status || {}).rules > 0), 'rules applied');
    const banner = ui.locator('#access');
    await until(() => banner.isVisible(), 'access banner');
    assert.match(await banner.innerText(), /needs your permission/);
    const page = await ctx.newPage();
    const got = await echoVia(page, A + '/echo');
    assert.strictEqual(got['x-headerdial'], undefined, 'no header without host access');
    ok('without host access the shipped build changes nothing and shows the access banner');
    await ctx.close();
  }

  // ---- 2. With host access: the real behaviour.
  const { ctx, id, sw } = await launch(grantedCopy());
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${id}/popup.html?page=1`);
  const page = await ctx.newPage();
  const status = () => ui.evaluate(async () => (await chrome.storage.local.get('status')).status || {});
  const settle = async () => { await sleep(400); await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'sync' })); };

  assert.ok(!(await ui.locator('#access').isVisible()), 'no banner when access is granted');

  // Typed in the UI: one request header, one response header.
  await ui.locator('input.name').first().fill('X-HeaderDial');
  await ui.locator('input.value').first().fill('on');
  await ui.click('#add-res');
  await ui.locator('#res-rows input.name').fill('X-Served-By');
  await ui.locator('#res-rows input.value').fill('headerdial');
  await settle();
  await until(async () => (await status()).live === 2, 'two live headers');

  let got = await echoVia(page, A + '/echo');
  assert.strictEqual(got['x-headerdial'], 'on');
  ok('request header added on a page load (main_frame)');

  let f = await fetchVia(page, A + '/echo?xhr');
  assert.strictEqual(f.body['x-headerdial'], 'on');
  assert.strictEqual(f.resp['x-served-by'], 'headerdial');
  ok('request header on fetch() and response header visible to the page');

  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  assert.strictEqual(badge, '2');
  ok('badge shows the number of active headers');

  // Keyboard shortcut: registered with its default key, and its handler pauses and resumes.
  const cmds = await sw.evaluate(() => chrome.commands.getAll());
  const pauseCmd = cmds.find((c) => c.name === 'toggle-pause');
  assert.ok(pauseCmd && /Alt\+Shift\+D/.test(pauseCmd.shortcut), 'toggle-pause shortcut: ' + JSON.stringify(cmds));
  assert.strictEqual(await sw.evaluate(() => togglePause()), true);
  await until(async () => (await sw.evaluate(() => chrome.action.getBadgeText({}))) === 'off', 'badge shows off');
  assert.strictEqual((await echoVia(page, A + '/echo'))['x-headerdial'], undefined);
  assert.strictEqual(await sw.evaluate(() => togglePause()), false);
  await until(async () => (await sw.evaluate(() => chrome.action.getBadgeText({}))) === '2', 'badge back to 2');
  assert.strictEqual((await echoVia(page, A + '/echo'))['x-headerdial'], 'on');
  ok('Alt+Shift+D shortcut is registered and pauses then resumes every header');

  // Method filter: a POST-only profile changes POST requests and leaves GET alone.
  await ui.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    state.profiles.push({ id: 'post-only', name: 'POST only', active: true, requestMethods: ['post'],
      headers: [{ target: 'request', name: 'X-Post-Only', value: 'yes' }] });
    await chrome.storage.local.set({ state });
  });
  await settle();
  await page.goto(A + '/');
  const byMethod = await page.evaluate(async () => {
    const g = await (await fetch('/echo?m')).json();
    const p = await (await fetch('/echo?m', { method: 'POST', body: 'x' })).json();
    return { get: g['x-post-only'] || null, post: p['x-post-only'] || null };
  });
  assert.deepStrictEqual(byMethod, { get: null, post: 'yes' });
  await ui.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    state.profiles = state.profiles.filter((p) => p.id !== 'post-only');
    await chrome.storage.local.set({ state });
  });
  await settle();
  ok('a request-method filter (POST only) changes POST and leaves GET alone');

  // Remove and override existing headers.
  await ui.click('#add-req');
  await ui.locator('#req-rows .hrow').nth(1).locator('input.name').fill('Accept-Language');
  await ui.locator('#req-rows .hrow').nth(1).locator('select').first().selectOption('remove');
  await ui.click('#add-req');
  await ui.locator('#req-rows .hrow').nth(2).locator('input.name').fill('User-Agent');
  await ui.locator('#req-rows .hrow').nth(2).locator('input.value').fill('HeaderDialBot/1.0');
  await settle();
  await until(async () => (await status()).live === 4, 'four live headers');
  got = await echoVia(page, A + '/echo');
  assert.strictEqual(got['accept-language'], undefined);
  assert.strictEqual(got['user-agent'], 'HeaderDialBot/1.0');
  ok('remove (Accept-Language) and override (User-Agent) work');

  // Filter: only on localhost.
  await ui.locator('details summary').click();
  await ui.getByRole('button', { name: '+ Only on…' }).click();
  await ui.locator('.frow select').nth(1).selectOption('domain');
  await ui.locator('.frow input.val').fill('localhost');
  await ui.locator('.frow input.val').press('Tab');
  await settle();
  await until(async () => (await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules()))
    .some((r) => (r.condition.requestDomains || []).includes('localhost')), 'domain rule');
  assert.strictEqual((await echoVia(page, A + '/echo'))['x-headerdial'], undefined);
  assert.strictEqual((await echoVia(page, B + '/echo'))['x-headerdial'], 'on');
  ok('"Only on" domain filter limits where headers apply');

  // Pause everything.
  await ui.locator('label.switch:has(#power)').click();
  await settle();
  await until(async () => (await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())).length === 0, 'rules cleared');
  assert.strictEqual((await echoVia(page, B + '/echo'))['x-headerdial'], undefined);
  assert.strictEqual(await sw.evaluate(() => chrome.action.getBadgeText({})), 'off');
  await ui.locator('label.switch:has(#power)').click();
  await settle();
  await until(async () => (await echoVia(page, B + '/echo'))['x-headerdial'] === 'on', 'resume');
  ok('pause clears all rules and resume restores them');

  // Import a ModHeader export through the dialog.
  const modheader = JSON.stringify([{ title: 'Imported', backgroundColor: '#006607', appendMode: false, hideComment: true, shortTitle: 'I',
    headers: [{ enabled: true, name: 'X-From-ModHeader', value: 'yes', comment: '' }], respHeaders: [], urlReplacements: [],
    filters: [{ enabled: true, type: 'urls', urlRegex: '.*://127\\.0\\.0\\.1:\\d+/.*', resourceType: [], comment: '' }] }]);
  await ui.click('#import');
  await ui.locator('#import-text').fill(modheader);
  await ui.click('#import-go');
  await until(async () => /Imported 1 profile from ModHeader/.test(await ui.locator('#import-msg').innerText()), 'import message');
  if (SHOTS) await ui.screenshot({ path: path.join(SHOTS, 'import.png') });
  await ui.locator('#import-dialog button[value=cancel]').click();
  await settle();
  await until(async () => (await echoVia(page, A + '/echo'))['x-from-modheader'] === 'yes', 'imported header applied');
  got = await echoVia(page, B + '/echo');
  assert.strictEqual(got['x-from-modheader'], undefined, 'imported regex filter respected');
  assert.strictEqual(got['x-headerdial'], 'on', 'first profile still active alongside');
  ok('ModHeader export imports through the dialog and applies with its URL filter, alongside other profiles');

  // Timed header: expires on its own.
  await ui.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    state.profiles[1].headers[0].expiresAt = Date.now() + 2500;
    await chrome.storage.local.set({ state });
  });
  await sleep(500);
  assert.strictEqual((await echoVia(page, A + '/echo'))['x-from-modheader'], 'yes');
  await until(async () => (await echoVia(page, A + '/echo'))['x-from-modheader'] === undefined, 'header expired', 15000);
  ok('a timed header switches itself off when it expires');

  // Tab-only profile: session rule bound to one tab.
  const other = await ctx.newPage();
  await other.goto(A + '/');
  // The extension has no "tabs" permission, so it cannot read URLs; the newest tab is ours.
  const tabId = await sw.evaluate(async () => Math.max(...(await chrome.tabs.query({})).map((t) => t.id)));
  await ui.evaluate(async (tid) => {
    const { state } = await chrome.storage.local.get('state');
    state.profiles.push({ id: 'tabp', name: 'Tab only', active: true, tabId: tid, tabLabel: 'test',
      headers: [{ name: 'X-Tab', value: '1', enabled: true }], filters: [] });
    await chrome.storage.local.set({ state });
  }, tabId);
  await settle();
  await until(async () => (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length === 1, 'session rule');
  assert.strictEqual((await fetchVia(other, A + '/echo')).body['x-tab'], '1');
  assert.strictEqual((await fetchVia(page, A + '/echo')).body['x-tab'], undefined);
  ok('a tab-only profile applies in its tab and nowhere else');

  // A regex the browser cannot compile is reported, and the other rules still work.
  await ui.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    state.profiles[0].filters.push({ kind: 'include', type: 'regex', value: '(?<=x)y', enabled: true });
    await chrome.storage.local.set({ state });
  });
  await settle();
  const st = await until(async () => { const s = await status(); return s.problems && s.problems.length ? s : null; }, 'problem reported');
  assert.match(st.problems.map((p) => p.message).join('\n'), /rejected/);
  assert.strictEqual((await echoVia(page, B + '/echo'))['x-headerdial'], 'on');
  await until(() => ui.locator('#problems').isVisible(), 'problems shown in UI');
  ok('a rule the browser rejects is reported in the UI without disabling the rest');

  // CORS for local development: a cross-origin call is blocked until HeaderDial adds the headers.
  const corsTry = (url, custom) => page.evaluate(async ([u, c]) => {
    try { const r = await fetch(u, c ? { headers: { 'X-Custom': 'yes' } } : {}); return (await r.json()).ok ? 'ok' : 'bad'; }
    catch (e) { return 'blocked'; }
  }, [url, custom]);
  await page.goto(A + '/');
  assert.strictEqual(await corsTry(B + '/nocors', false), 'blocked', 'precondition: cross-origin call is blocked');
  await ui.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    state.profiles.push({ id: 'cors', name: 'CORS', active: true, filters: [{ kind: 'include', type: 'domain', value: 'localhost' }],
      headers: [{ target: 'response', name: 'Access-Control-Allow-Origin', value: '*' },
        { target: 'response', name: 'Access-Control-Allow-Headers', value: '*' }] });
    await chrome.storage.local.set({ state });
  });
  await settle();
  await until(async () => (await corsTry(B + '/nocors', false)) === 'ok', 'simple CORS request allowed');
  ok('adding Access-Control-Allow-Origin makes a blocked simple cross-origin GET succeed');
  assert.strictEqual(await corsTry(B + '/nocors?pre', true), 'ok');
  ok('a preflighted request (custom header) also succeeds: the added headers apply to the OPTIONS response too');

  if (SHOTS) {
    await ui.setViewportSize({ width: 1280, height: 800 });
    await ui.reload();
    await ui.screenshot({ path: path.join(SHOTS, 'page.png') });
  }
  await ctx.close();

  // ---- 3. Which site access CORS needs when the page and the API are on different hosts
  // (the CORS guide tells users this). Page on 127.0.0.1, API on localhost.
  const corsWith = async (hosts) => {
    const l = await launch(grantedCopy(hosts));
    const u = await l.ctx.newPage();
    await u.goto(`chrome-extension://${l.id}/popup.html?page=1`);
    await u.evaluate(async () => {
      const state = { profiles: [{ id: 'cors', name: 'CORS', active: true, filters: [{ kind: 'include', type: 'domain', value: 'localhost' }],
        headers: [{ target: 'response', name: 'Access-Control-Allow-Origin', value: '*' },
          { target: 'response', name: 'Access-Control-Allow-Headers', value: '*' }] }] };
      await chrome.storage.local.set({ state });
      await chrome.runtime.sendMessage({ type: 'sync' });
    });
    const pg = await l.ctx.newPage();
    await pg.goto(A + '/');
    await sleep(300);
    const res = await pg.evaluate(async (url) => {
      try { const r = await fetch(url); return (await r.json()).ok ? 'ok' : 'bad'; } catch (e) { return 'blocked'; }
    }, B + '/nocors');
    await l.ctx.close();
    return res;
  };
  const access = {
    pageOnly: await corsWith(['http://127.0.0.1/*']),
    apiOnly: await corsWith(['http://localhost/*']),
    both: await corsWith(['http://127.0.0.1/*', 'http://localhost/*']),
  };
  console.log('   site access needed for CORS:', JSON.stringify(access));
  assert.strictEqual(access.pageOnly, 'blocked', 'access to the page host alone does not change the API response');
  assert.strictEqual(access.apiOnly, 'blocked', 'access to the API host alone is not enough either (initiator needs it)');
  assert.strictEqual(access.both, 'ok', 'access to both hosts works');
  ok('CORS across hosts needs site access for both the page host and the API host');

  srv.close();
  console.log(`\n${passed} e2e checks passed`);
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
