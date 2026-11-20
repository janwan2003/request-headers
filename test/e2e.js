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
      if (req.url.startsWith('/framed')) {
        // A page that refuses to be framed both ways (guide: allow-iframe-x-frame-options.html).
        res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
        res.end('<!doctype html><script>parent.postMessage("framed-loaded", "*")</script>');
        return;
      }
      if (req.url.startsWith('/nocors')) {
        // No CORS headers at all; answers preflights with an empty 204 (or 404 for /nocors404).
        res.writeHead(req.method === 'OPTIONS' ? (req.url.startsWith('/nocors404') ? 404 : 204) : 200, req.method === 'OPTIONS' ? {} : { 'content-type': 'application/json' });
        res.end(req.method === 'OPTIONS' ? '' : JSON.stringify({ ok: true, h: req.headers['x-custom'] || null }));
      } else if (req.url.startsWith('/sw.js')) {
        // Service worker: answers /swecho by fetching /echo itself (a request with no tab).
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(`self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { if (new URL(e.request.url).pathname === '/swecho') e.respondWith(fetch('/echo?fromsw')); });`);
      } else if (req.url.startsWith('/setcookie')) {
        res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'sc=1; Path=/' });
        res.end('ok');
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

async function launch(extDir, extraArgs = []) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-prof-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true, viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, ...extraArgs],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  return { ctx, sw, id };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => {
  const s = require('net').createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

// The real toolbar popup: chrome.action.openPopup() opens it, but Playwright does not
// list popups as pages, so this talks to it over the DevTools protocol directly.
async function openToolbarPopup(sw, port) {
  await sw.evaluate(() => chrome.action.openPopup());
  let target;
  await until(async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = list.find((t) => t.type === 'page' && /popup\.html$/.test(t.url));
    return target;
  }, 'toolbar popup target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let n = 0;
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const id = ++n;
    const onMsg = (m) => {
      const d = JSON.parse(m.data);
      if (d.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (d.error || d.result.exceptionDetails) reject(new Error(JSON.stringify(d.error || d.result.exceptionDetails).slice(0, 300)));
      else resolve(d.result.result.value);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  return { evaluate, close: () => ws.close() };
}
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

  // URL redirect typed in the UI: "/old/" in the URL becomes "/echo/", on page loads and
  // fetch(), and the profile's request header still reaches the redirected request.
  await ui.click('#add-redir');
  await ui.locator('#redir-rows input.from').fill(A + '/old/');
  await ui.locator('#redir-rows input.to').fill(A + '/echo/');
  await settle();
  await until(async () => (await status()).live === 3, 'two headers + one redirect live');
  got = await echoVia(page, A + '/old/page?q=1');
  assert.strictEqual(page.url(), A + '/echo/page?q=1');
  assert.strictEqual(got['x-headerdial'], 'on', 'header applied after the redirect');
  const viaFetch = await page.evaluate(async () => { const r = await fetch('/old/api'); return { url: r.url, redirected: r.redirected }; });
  assert.deepStrictEqual(viaFetch, { url: A + '/echo/api', redirected: true });
  assert.strictEqual(await sw.evaluate(() => chrome.action.getBadgeText({})), '3');
  // A target that contains its own source would loop: flagged in the row, not applied.
  await ui.locator('#redir-rows input.to').fill(A + '/old/v2/');
  await settle();
  await until(async () => (await status()).live === 2, 'looping redirect not applied');
  assert.ok(await ui.locator('#redir-rows .rrow.bad').isVisible(), 'looping row marked');
  await ui.click('#redir-rows button[aria-label="Delete redirect"]');
  await settle();
  await until(async () => (await status()).live === 2, 'redirect deleted');
  await page.goto(A + '/old/page');
  assert.strictEqual(page.url(), A + '/old/page');
  ok('a URL redirect typed in the UI applies to page loads and fetch(), keeps headers, and refuses a loop');

  // Claims in the Origin and Cookie guides: Origin can be set; removing Set-Cookie on a
  // response stops the browser storing the cookie.
  await ui.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    state.profiles.push({ id: 'guides', name: 'Guides', active: true, filters: [{ kind: 'include', type: 'pattern', value: '/setcookie' }],
      headers: [{ target: 'request', name: 'Origin', value: 'https://evil.example' },
        { target: 'response', name: 'Set-Cookie', op: 'remove' }] });
    state.profiles.push({ id: 'origin', name: 'Origin', active: true, filters: [{ kind: 'include', type: 'pattern', value: '/echo?origin' }],
      headers: [{ target: 'request', name: 'Origin', value: 'https://evil.example' }] });
    await chrome.storage.local.set({ state });
  });
  await settle();
  await page.goto(A + '/');
  const guideFacts = await page.evaluate(async () => {
    const o = await (await fetch('/echo?origin', { method: 'POST', body: 'x' })).json();
    await fetch('/setcookie');
    return { origin: o.origin || null, cookie: document.cookie };
  });
  assert.strictEqual(guideFacts.origin, 'https://evil.example');
  assert.doesNotMatch(guideFacts.cookie, /sc=1/);
  await ui.evaluate(async () => {
    const { state } = await chrome.storage.local.get('state');
    state.profiles = state.profiles.filter((p) => p.id !== 'guides' && p.id !== 'origin');
    await chrome.storage.local.set({ state });
  });
  await settle();
  await page.evaluate(() => fetch('/setcookie'));
  assert.match(await page.evaluate(() => document.cookie), /sc=1/, 'control: without the rule the cookie is stored');
  ok('Origin can be set on fetch, and removing Set-Cookie stops the cookie being stored');

  // Cookie rows typed in the UI. Measured: what the server receives when the browser
  // already has cookies (including one with the same name), and what a "Store" row saves.
  await page.goto(A + '/');
  await page.evaluate(() => { document.cookie = 'sc=; Max-Age=0; Path=/'; document.cookie = 'pre=0; Path=/'; document.cookie = 'dup=browser; Path=/'; });
  const liveBefore = (await status()).live;
  await ui.click('#add-cookie');
  await ui.locator('#cookie-rows .crow').nth(0).locator('input.name').fill('hd');
  await ui.locator('#cookie-rows .crow').nth(0).locator('input.value').fill('1');
  await ui.click('#add-cookie');
  await ui.locator('#cookie-rows .crow').nth(1).locator('input.name').fill('dup');
  await ui.locator('#cookie-rows .crow').nth(1).locator('input.value').fill('ext');
  await settle();
  await until(async () => (await status()).live === liveBefore + 2, 'two cookie rows live');
  assert.doesNotMatch(await ui.locator('#cookie-rows').innerText(), /false|null|undefined/, 'no stray text in cookie rows');
  const sentCookie = (await fetchVia(page, A + '/echo?cookie')).body.cookie;
  assert.strictEqual(sentCookie, 'pre=0; dup=browser; hd=1; dup=ext', 'Cookie header: ' + sentCookie);
  assert.strictEqual((await echoVia(page, A + '/echo')).cookie, 'pre=0; dup=browser; hd=1; dup=ext', 'page loads too');
  // With no browser cookies at all, the row still creates the header.
  const noJar = await page.evaluate(async (u) => (await (await fetch(u, { credentials: 'omit' })).json()).cookie || null, B + '/echo?nojar');
  assert.strictEqual(noJar, 'hd=1; dup=ext', 'credentials: omit still gets the added cookies: ' + noJar);
  // "Store" rows: two Set-Cookie lines added to a response; the browser saves both,
  // and the stored one replaces a cookie with the same name.
  await ui.locator('#cookie-rows .crow').nth(0).locator('select').selectOption('response');
  await ui.locator('#cookie-rows .crow').nth(1).locator('select').selectOption('response');
  await settle();
  await until(async () => ((await sw.evaluate(() => chrome.declarativeNetRequest.getDynamicRules()))
    .flatMap((r) => (r.action.responseHeaders || [])).filter((h) => h.header === 'set-cookie')).length === 2, 'two set-cookie rules');
  await page.evaluate(() => fetch('/echo?store'));
  const jar = await page.evaluate(() => document.cookie);
  assert.match(jar, /(^|; )hd=1(;|$)/, 'stored hd: ' + jar);
  assert.match(jar, /(^|; )dup=ext(;|$)/, 'dup replaced: ' + jar);
  assert.doesNotMatch(jar, /dup=browser/);
  // Copy as curl shows this profile's request headers.
  await ui.locator('.pbar .menu button').click();
  await ui.getByRole('button', { name: 'Copy as curl…' }).click();
  const curl = await ui.locator('#curl-text').inputValue();
  assert.match(curl, /^# not in curl \(browser only\): response cookie hd/m);
  assert.match(curl, /-H 'X-HeaderDial: on'/);
  await ui.locator('#curl-dialog button[value=cancel]').click();
  while (await ui.locator('#cookie-rows .crow').count()) await ui.locator('#cookie-rows button[aria-label="Delete cookie"]').first().click();
  await settle();
  await until(async () => (await status()).live === liveBefore, 'cookie rows deleted');
  await page.evaluate(() => { for (const c of ['pre', 'dup', 'hd']) document.cookie = c + '=; Max-Age=0; Path=/'; });
  ok('cookie rows: Send adds to the browser\'s cookies (same name: both sent, browser\'s first), Store saves and replaces; copy as curl');

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

  // The same dialog takes the LevelDB files of a disabled ModHeader (fixture written by Chromium).
  {
    await ui.click('#import');
    const fx = path.join(root, 'test/fixtures/chrome-storage-local');
    await ui.setInputFiles('#import-file', fs.readdirSync(fx).filter((f) => /\.(ldb|log)$/.test(f)).map((f) => path.join(fx, f)));
    await until(async () => /Found 3 ModHeader profiles\. Click Import\./.test(await ui.locator('#import-msg').innerText()), 'LevelDB import message');
    const text = await ui.locator('#import-text').inputValue();
    assert.deepStrictEqual(JSON.parse(text).map((p) => p.title), ['Staging', 'Bulk', 'Append']);
    await ui.locator('#import-text').fill('');
    await ui.locator('#import-dialog button[value=cancel]').click();
    ok('import dialog reads a disabled ModHeader\'s LevelDB files into importable JSON');
  }

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
  // Guide guard (modify-headers-one-tab-only.html): a request the site's service worker makes,
  // even for the bound tab's own fetch(), has no tab, so the tab-only header is not sent.
  const viaSw = await other.evaluate(async () => {
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
    const out = { controlled: !!navigator.serviceWorker.controller, sw: await (await fetch('/swecho')).json(), direct: await (await fetch('/echo?direct')).json() };
    await reg.unregister();
    return out;
  });
  assert.ok(viaSw.controlled, 'the page is controlled by the service worker');
  assert.ok(viaSw.sw.host, 'the service worker reached the server');
  assert.strictEqual(viaSw.sw['x-tab'], undefined, 'service worker request: no tab-only header');
  assert.strictEqual(viaSw.direct['x-tab'], '1', 'the same tab without the worker: header sent');
  ok('guide claim holds: a tab-only profile misses requests made by the site\'s service worker');

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
  // Guide guard (fix-cors-error-while-testing.html): a preflight answered with 404 stays blocked,
  // whatever headers are added; the browser wants an ok status.
  assert.strictEqual(await corsTry(B + '/nocors404?pre', true), 'blocked', 'OPTIONS 404 cannot be fixed with headers');
  assert.strictEqual(await corsTry(B + '/nocors404?simple', false), 'ok', 'control: no preflight, works');
  ok('guide claim holds: a preflight answered with 404 stays blocked even with CORS headers added');

  // Guide guard: guides/headers-browsers-wont-let-you-change.html says Chrome lets an extension
  // set Sec-Fetch-Site, but removing Host or Connection has no effect. Fail if a release changes that.
  {
    const saved = await ui.evaluate(async () => (await chrome.storage.local.get('state')).state);
    await ui.evaluate(async () => {
      await chrome.storage.local.set({ state: { profiles: [{ id: 'guard', name: 'Guard', active: true, headers: [
        { target: 'request', name: 'Sec-Fetch-Site', value: 'hd-guard' },
        { target: 'request', name: 'Host', op: 'remove', value: '' },
        { target: 'request', name: 'Connection', op: 'remove', value: '' }] }] } });
    });
    await settle();
    const got = await until(async () => { const g = await echoVia(page, A + '/echo'); return g['sec-fetch-site'] === 'hd-guard' && g; }, 'Sec-Fetch-Site set');
    assert.strictEqual(got.host, `127.0.0.1:${port}`, 'removing Host has no effect (guide claim)');
    assert.ok(got.connection, 'removing Connection has no effect in Chrome (guide claim)');
    const st = await status();
    assert.deepStrictEqual(st.problems, [], 'the browser accepted the rule; it just ignores the removals');
    await ui.evaluate(async (s) => chrome.storage.local.set({ state: s }), saved);
    await settle();
    ok('guide claims hold in this Chrome: Sec-Fetch-Site can be set, Host and Connection cannot be removed');
  }

  // A "Never on" URL filter in a higher profile must not switch off the profiles below it
  // (DNR allow rules cut every lower rule; the compiler copies the lower profile's rules up).
  // And a "Page domain" filter applies to requests made by pages on that site only.
  {
    const saved = await ui.evaluate(async () => (await chrome.storage.local.get('state')).state);
    await ui.evaluate(async () => {
      await chrome.storage.local.set({ state: { profiles: [
        { id: 'ex', name: 'Excluding', active: true, filters: [{ kind: 'exclude', type: 'pattern', value: '*skip*' }],
          headers: [{ target: 'request', name: 'X-Upper', value: '1' }, { target: 'request', name: 'X-Both', value: 'upper' }] },
        { id: 'low', name: 'Lower', active: true, headers: [{ target: 'request', name: 'X-Lower', value: '1' },
          { target: 'request', name: 'X-Both', value: 'lower' }] },
        { id: 'pd', name: 'Page domain', active: true, filters: [{ kind: 'include', type: 'initiator', value: 'localhost' }],
          headers: [{ target: 'request', name: 'X-From-Localhost', value: '1' }] }] } });
    });
    await settle();
    let g = await until(async () => { const x = await echoVia(page, A + '/echo?skip'); return x['x-lower'] && x; }, 'lower profile on an excluded URL');
    assert.deepStrictEqual([g['x-upper'], g['x-lower'], g['x-both']], [undefined, '1', 'lower']);
    g = await echoVia(page, A + '/echo?other');
    assert.deepStrictEqual([g['x-upper'], g['x-lower'], g['x-both']], ['1', '1', 'upper']);
    assert.deepStrictEqual((await status()).problems, []);
    ok('a "Never on" URL filter in the upper profile leaves the lower profile on (and the upper still wins elsewhere)');
    assert.strictEqual(g['x-from-localhost'], undefined, 'typed address: no initiator');
    await page.goto(B + '/');
    assert.strictEqual(await page.evaluate(async (u) => (await (await fetch(u)).json())['x-from-localhost'] || null, A + '/echo?pd'), '1');
    await page.goto(A + '/');
    assert.strictEqual(await page.evaluate(async (u) => (await (await fetch(u)).json())['x-from-localhost'] || null, A + '/echo?pd'), null);
    ok('"Page domain" filter: header on a fetch from a localhost page, not from another page or a typed address');
    await ui.evaluate(async (s) => chrome.storage.local.set({ state: s }), saved);
    await settle();
  }

  // Guide guard: guides/send-cookie-with-request.html has a table of what the server gets when a
  // Cookie header row and a Send cookie row sit in different profiles (browser has pre=0).
  {
    const saved = await ui.evaluate(async () => (await chrome.storage.local.get('state')).state);
    const setRow = { target: 'request', name: 'Cookie', value: 'fixed=abc', op: 'set' };
    const rmRow = { target: 'request', name: 'Cookie', value: '', op: 'remove' };
    const send = { headers: [], cookies: [{ target: 'request', name: 'hd', value: '1' }] };
    const cases = [
      [{ headers: [setRow] }, send, 'fixed=abc; hd=1'],
      [send, { headers: [setRow] }, 'pre=0; hd=1'],
      [{ headers: [rmRow] }, send, 'none'],
    ];
    await page.goto(A + '/');
    await page.evaluate(() => { document.cookie = 'pre=0; Path=/'; });
    for (const [left, right, want] of cases) {
      await ui.evaluate(async ([l, r]) => chrome.storage.local.set({ state: HeaderDial.normalizeState({ profiles: [
        { id: 'l', name: 'Left', active: true, ...l }, { id: 'r', name: 'Right', active: true, ...r }] }) }), [left, right]);
      await settle();
      assert.deepStrictEqual((await status()).problems, []);
      const got = (await echoVia(page, A + '/echo?cookies')).cookie || 'none';
      assert.strictEqual(got, want, `Chrome, left ${JSON.stringify(left)} / right ${JSON.stringify(right)}: server got ${got}`);
    }
    await page.goto(A + '/');
    await page.evaluate(() => { document.cookie = 'pre=; Max-Age=0; Path=/'; });
    await ui.evaluate(async (s) => chrome.storage.local.set({ state: s }), saved);
    await settle();
    ok('guide table holds for a Cookie header row and a Send row in different profiles');
  }

  // Recipes picked in the editor add working rows; picking one twice adds nothing.
  {
    const saved = await ui.evaluate(async () => (await chrome.storage.local.get('state')).state);
    await ui.evaluate(async () => chrome.storage.local.set({ state: HeaderDial.normalizeState({ profiles: [{ id: 'r', name: 'R', active: true }] }) }));
    await ui.reload();
    await ui.locator('#recipe').selectOption('xff');
    await ui.locator('#recipe').selectOption('xff');
    assert.strictEqual(await ui.locator('#req-rows .hrow').count(), 1, 'one row, the blank starter row dropped');
    await ui.locator('#recipe').selectOption('bearer');
    assert.strictEqual(await ui.evaluate(() => document.activeElement.value), 'Bearer ', 'the token field has focus');
    await ui.keyboard.type('t0ken');
    await ui.locator('#recipe').selectOption('iframe');
    await settle();
    const g = await until(async () => { const x = await echoVia(page, A + '/echo?recipe'); return x['x-forwarded-for'] && x; }, 'recipe rows live');
    assert.deepStrictEqual([g['x-forwarded-for'], g.authorization], ['203.0.113.7', 'Bearer t0ken']);
    assert.strictEqual(await ui.locator('#res-rows .hrow').count(), 2);
    assert.deepStrictEqual((await status()).problems, []);
    await ui.evaluate(async (s) => chrome.storage.local.set({ state: s }), saved);
    await ui.reload();
    await settle();
    ok('recipes add working rows from the editor (and the token field gets focus)');
  }

  // Guide guard (allow-iframe-x-frame-options.html): with both X-Frame-Options and CSP
  // frame-ancestors, removing X-Frame-Options alone still blocks the frame; removing both loads it.
  {
    const saved = await ui.evaluate(async () => (await chrome.storage.local.get('state')).state);
    const frame = async (rows) => {
      await ui.evaluate(async (hs) => chrome.storage.local.set({ state: HeaderDial.normalizeState({ profiles: [{ id: 'f', name: 'F', active: true,
        headers: hs.map((n) => ({ target: 'response', name: n, value: '', op: 'remove' })) }] }) }), rows);
      await settle();
      await page.goto(B + '/');
      return page.evaluate(async (src) => {
      const f = document.createElement('iframe');
      const got = new Promise((r) => { addEventListener('message', (e) => e.data === 'framed-loaded' && r('loads')); setTimeout(() => r('blocked'), 2500); });
      f.src = src; document.body.append(f);
      const out = await got; f.remove(); return out;
    }, A + '/framed');
    };
    assert.strictEqual(await frame([]), 'blocked', 'control: the page refuses to be framed');
    assert.strictEqual(await frame(['X-Frame-Options']), 'blocked', 'frame-ancestors still blocks it');
    assert.strictEqual(await frame(['X-Frame-Options', 'Content-Security-Policy']), 'loads');
    await ui.evaluate(async (s) => chrome.storage.local.set({ state: s }), saved);
    await settle();
    ok('guide claim holds: framing needs both X-Frame-Options and CSP frame-ancestors removed');
  }

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

  // ---- 4. The toolbar popup with a real tab behind it, access granted for one site only.
  {
    const port = await freePort();
    const l = await launch(grantedCopy(['http://127.0.0.1/*']), [`--remote-debugging-port=${port}`]);
    await l.sw.evaluate(async () => {
      await chrome.storage.local.set({ state: { profiles: [{ id: 'p1', name: 'Test', active: true,
        headers: [{ target: 'request', name: 'X-HeaderDial', value: 'popup' }] }] } });
      await chrome.runtime.sendMessage({ type: 'sync' }).catch(() => {});
    });
    await sleep(500);
    const tabPage = await l.ctx.newPage();
    await tabPage.goto(A + '/');
    await tabPage.bringToFront();
    const pop = await openToolbarPopup(l.sw, port);
    await until(() => pop.evaluate(`!document.getElementById('access').hidden`), 'popup access banner');
    const banner = await pop.evaluate(`document.getElementById('access').innerText`);
    assert.match(banner, /changed on 1 site you allowed/);
    assert.doesNotMatch(banner, /\b(null|false|undefined)\b/);
    ok('toolbar popup: banner counts the one allowed site and offers all sites');

    const added = await pop.evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent === '+ Only on 127.0.0.1');
      if (!b) return false; b.click(); return true; })()`);
    assert.ok(added, '"+ Only on 127.0.0.1" button is offered for the tab behind the popup');
    await until(async () => {
      const { state } = await l.sw.evaluate(() => chrome.storage.local.get('state'));
      return (state.profiles[0].filters || []).some((f) => f.type === 'domain' && f.value === '127.0.0.1');
    }, 'domain filter saved from the popup');
    ok('toolbar popup: "+ Only on <host>" adds a domain filter for the current tab');

    const tabId = await l.sw.evaluate(async () =>
      (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith('http://127.0.0.1')).id);
    await pop.evaluate(`(() => {
      const label = [...document.querySelectorAll('label')].find((x) => /Only in this tab/.test(x.textContent));
      label.querySelector('input').click(); })()`);
    await until(async () => {
      const { state } = await l.sw.evaluate(() => chrome.storage.local.get('state'));
      return state.profiles[0].tabId === tabId;
    }, 'profile bound to the tab behind the popup');
    pop.close();
    await l.sw.evaluate(() => chrome.runtime.sendMessage({ type: 'sync' }).catch(() => {}));
    await sleep(500);
    const inTab = await echoVia(tabPage, A + '/echo');
    const other = await l.ctx.newPage();
    const elsewhere = await echoVia(other, A + '/echo');
    assert.strictEqual(inTab['x-headerdial'], 'popup');
    assert.strictEqual(elsewhere['x-headerdial'], undefined);
    ok('toolbar popup: "Only in this tab" binds the profile to the tab behind the popup');
    await l.ctx.close();
  }

  // ---- 5. The "Recover ModHeader profiles" page (no extension): choose the LevelDB files
  // a real Chromium wrote (test/fixtures) and check what the page offers to download.
  {
    const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true });
    const bctx = await browser.newContext({ acceptDownloads: true });
    const page = await bctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('request', (r) => { if (!r.url().startsWith('file:')) errors.push('network request: ' + r.url()); });
    await page.goto('file://' + path.join(root, 'dist/site/guides/recover-modheader-profiles.html'));
    const fx = path.join(root, 'test/fixtures/chrome-storage-local');
    await page.setInputFiles('#pick-files', fs.readdirSync(fx).map((f) => path.join(fx, f)));
    await until(async () => /Found 1 set/.test(await page.locator('#status').innerText()), 'recover page result');
    const rows = await page.locator('#result table tr').allInnerTexts();
    assert.deepStrictEqual(rows.slice(1).map((r) => r.split('\t')[0]), ['Staging', 'Bulk', 'Append']);
    assert.match(rows[2], /Bulk\t900\t1\t0\t1/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#result button.primary').click()]);
    const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert.deepStrictEqual(saved.map((p) => p.title), ['Staging', 'Bulk', 'Append']);
    // Files that are not LevelDB data get a clear message instead of a crash.
    await page.setInputFiles('#pick-files', [path.join(fx, 'CURRENT')]);
    await until(async () => /No LevelDB files/.test(await page.locator('#status').innerText()), 'no-data message');
    assert.deepStrictEqual(errors, []);
    ok('recover page reads a real Chromium LevelDB folder locally and downloads the newest ModHeader profiles');
    await browser.close();
  }

  srv.close();
  console.log(`\n${passed} e2e checks passed`);
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
