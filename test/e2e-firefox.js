// Firefox end-to-end: install the Firefox build into a real Firefox over WebDriver BiDi
// (no Playwright: its Firefox cannot load extensions) and check, against a local echo
// server, the headers the server really receives and the page really sees.
// Usage: node test/e2e-firefox.js   (env FIREFOX=/path/to/firefox; default: firefox on PATH)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const assert = require('assert');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const built = path.join(root, 'dist/firefox');
const FIREFOX = process.env.FIREFOX || 'firefox';
const ADDON_ID = 'headerdial@plainbyte';
const UUID = '6d1c0d5e-4f0a-4b8e-9a1f-0c3d2e1b7a55'; // fixed so the test knows the moz-extension:// origin
// Under the repo, not /tmp: the snap-packaged Firefox has a private /tmp.
const TMP = path.join(root, '.tmp');
fs.mkdirSync(TMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url.startsWith('/framed')) {
        // A page that refuses to be framed both ways (guide: allow-iframe-x-frame-options.html).
        res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" });
        res.end('<!doctype html><script>parent.postMessage("framed-loaded", "*")</script>');
        return;
      }
      if (req.url.startsWith('/echo')) {
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

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// Firefox shows host permissions in its install prompt and grants them, which a test
// cannot click; this copy declares them as required. The shipped build keeps them optional.
function copyBuild(granted) {
  const dir = fs.mkdtempSync(path.join(TMP, 'fx-ext-'));
  fs.cpSync(built, dir, { recursive: true });
  if (granted) {
    const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    mf.host_permissions = ['<all_urls>'];
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(mf));
  }
  return dir;
}

async function launch() {
  const profile = fs.mkdtempSync(path.join(TMP, 'fx-prof-'));
  fs.writeFileSync(path.join(profile, 'user.js'), [
    `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [ADDON_ID]: UUID }))});`,
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("devtools.jsonview.enabled", false);',
  ].join('\n') + '\n');
  const port = await freePort();
  const proc = spawn(FIREFOX, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), '--remote-allow-system-access'],
    { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } }); // older Firefox reads the flag, newer the variable
  await new Promise((resolve, reject) => {
    let err = '';
    const t = setTimeout(() => reject(new Error('Firefox did not start BiDi: ' + err.slice(-500))), 30000);
    proc.stderr.on('data', (d) => { err += d; if (/WebDriver BiDi listening/.test(err)) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => reject(new Error('Firefox exited ' + c + ': ' + err.slice(-500))));
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let next = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.type === 'error') reject(new Error(m.error + ': ' + m.message)); else resolve(m.result);
    }
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('session.new', { capabilities: {} });
  const { contexts } = await send('browsingContext.getTree', {});
  const close = async () => {
    // browser.close ends Firefox itself; killing only the launcher would leave the
    // snap-packaged Firefox running and still writing to the profile.
    try { await send('browser.close', {}); } catch (e) { /* the socket closes as Firefox exits */ }
    ws.close();
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(10000)]);
    if (proc.exitCode == null) proc.kill();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  };
  return { send, ctx: contexts[0].context, close };
}

(async () => {
  const srv = await serve();
  const A = `http://127.0.0.1:${srv.address().port}`;
  let passed = 0;
  const ok = (name) => { passed++; console.log('ok -', name); };

  async function session(granted) {
    const b = await launch();
    const ext = copyBuild(granted);
    const { extension } = await b.send('webExtension.install', { extensionData: { type: 'path', path: ext } });
    assert.strictEqual(extension, ADDON_ID);
    // BiDi refuses to navigate a tab to moz-extension://, so extension pages are opened
    // from the browser's own (chrome) window, which needs --remote-allow-system-access.
    const go = async (url) => {
      if (!url.startsWith('moz-extension:')) return b.send('browsingContext.navigate', { context: b.ctx, url, wait: 'complete' });
      // Leave the current page first, so the wait below cannot match the old document.
      await b.send('browsingContext.navigate', { context: b.ctx, url: 'about:blank', wait: 'complete' });
      const { contexts } = await b.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
      await b.send('script.evaluate', { target: { context: contexts[0].context }, awaitPromise: false,
        expression: `gBrowser.selectedBrowser.fixupAndLoadURIString(${JSON.stringify(url)}, ` +
          `{ triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() })` });
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        const r = await b.send('script.evaluate', { target: { context: b.ctx }, awaitPromise: false,
          expression: 'location.href + " " + document.readyState + " " + (typeof HeaderDial)' }).catch(() => null);
        if (r && r.result && r.result.value === url + ' complete object') return;
        await sleep(100);
      }
      throw new Error('extension page did not load: ' + url);
    };
    const run = async (expr) => {
      const r = await b.send('script.evaluate', { expression: expr, target: { context: b.ctx }, awaitPromise: true });
      if (r.type === 'exception') throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };
    const ui = `moz-extension://${UUID}/popup.html?page=1`;
    // Writes profiles the way the editor does (storage), then waits until the background
    // script has compiled them into rules.
    const setState = async (mutation) => {
      await go(ui);
      await run(`(async () => {
        // On a fresh profile the editor's init() saves a default state; wait for it, or
        // that save can land after ours and undo it.
        for (let i = 0; i < 100 && !(await chrome.storage.local.get('state')).state; i++) await new Promise((r) => setTimeout(r, 50));
        const s = HeaderDial.normalizeState((await chrome.storage.local.get('state')).state);
        const p = s.profiles[0];
        ${mutation}
        await chrome.storage.local.set({ state: s });
        // The background script loops until it has synced the newest state, so this
        // reply comes after our change is in the rules (an earlier sync may be running).
        await chrome.runtime.sendMessage({ type: 'sync' });
      })()`);
      return JSON.parse(await run(`chrome.storage.local.get('status').then((x) => JSON.stringify(x.status || null))`));
    };
    const echo = async () => { await go(A + '/echo'); return JSON.parse(await run('document.body.innerText')); };
    return { ...b, go, run, setState, echo, cleanup: async () => { await b.close(); fs.rmSync(ext, { recursive: true, force: true }); } };
  }

  // ---- 1. Shipped manifest (host access optional, not granted): nothing changes.
  {
    const s = await session(false);
    const st = await s.setState(`p.headers = [HeaderDial.newHeader('request', { name: 'X-HeaderDial', value: 'on' })];`);
    assert.ok(st.rules > 0, 'rules were registered');
    const got = await s.echo();
    assert.strictEqual(got['x-headerdial'], undefined);
    ok('Firefox: without host access the shipped build changes nothing');
    await s.go(`moz-extension://${UUID}/popup.html?page=1`);
    await sleep(500);
    const banner = await s.run(`(() => { const b = document.getElementById('access'); return b && !b.hidden && b.offsetParent !== null ? b.innerText : ''; })()`);
    assert.match(banner, /needs your permission/);
    ok('Firefox: the editor shows the site-access banner');
    await s.cleanup();
  }

  // ---- 2. With host access.
  const s = await session(true);
  let st = await s.setState(`p.headers = [
    HeaderDial.newHeader('request', { name: 'X-HeaderDial', value: 'on' }),
    HeaderDial.newHeader('request', { name: 'Accept-Language', op: 'remove' }),
    HeaderDial.newHeader('request', { name: 'User-Agent', value: 'HeaderDialTest/1.0' }),
    HeaderDial.newHeader('response', { name: 'X-Served-By', value: 'headerdial' }),
  ];`);
  assert.deepStrictEqual(st.problems, [], 'no rule rejected: ' + JSON.stringify(st.problems));
  assert.strictEqual(st.live, 4);
  let got = await s.echo();
  assert.strictEqual(got['x-headerdial'], 'on');
  ok('Firefox: request header added on a page load');
  assert.strictEqual(got['accept-language'], undefined);
  ok('Firefox: request header removed');
  assert.strictEqual(got['user-agent'], 'HeaderDialTest/1.0');
  ok('Firefox: existing request header overridden (User-Agent)');
  const resp = await s.run(`fetch('/echo?xhr').then(async (r) => JSON.stringify({ h: r.headers.get('x-served-by'), b: await r.json() }))`);
  const r = JSON.parse(resp);
  assert.strictEqual(r.h, 'headerdial');
  assert.strictEqual(r.b['x-headerdial'], 'on');
  ok('Firefox: header on fetch() and response header visible to the page');

  // Domain filter that does not match: header gone.
  await s.setState(`p.filters = [HeaderDial.newFilter('include', { type: 'domain', value: 'example.com' })];`);
  got = await s.echo();
  assert.strictEqual(got['x-headerdial'], undefined);
  await s.setState(`p.filters = [HeaderDial.newFilter('include', { type: 'domain', value: '127.0.0.1' })];`);
  got = await s.echo();
  assert.strictEqual(got['x-headerdial'], 'on');
  ok('Firefox: domain filter limits where headers apply');

  // Regex filter.
  await s.setState(`p.filters = [HeaderDial.newFilter('include', { type: 'regex', value: '^http://127\\\\.0\\\\.0\\\\.1:\\\\d+/echo' })];`);
  got = await s.echo();
  assert.strictEqual(got['x-headerdial'], 'on');
  ok('Firefox: regex filter');

  // Method filter: POST only.
  await s.setState(`p.filters = []; p.requestMethods = ['post'];`);
  await s.go(A + '/');
  const byMethod = JSON.parse(await s.run(`(async () => {
    const g = await (await fetch('/echo?m')).json();
    const q = await (await fetch('/echo?m', { method: 'POST', body: 'x' })).json();
    return JSON.stringify({ get: g['x-headerdial'] || null, post: q['x-headerdial'] || null });
  })()`));
  assert.deepStrictEqual(byMethod, { get: null, post: 'on' });
  await s.setState(`p.requestMethods = [];`);
  ok('Firefox: request-method filter (POST only)');

  // URL redirect ("replace" mode): page load and fetch() both end up on /echo/.
  st = await s.setState(`p.redirects = [HeaderDial.newRedirect({ from: '${A}/old/', to: '${A}/echo/' })];`);
  assert.deepStrictEqual(st.problems, [], 'redirect accepted: ' + JSON.stringify(st.problems));
  await s.go(A + '/old/page?q=1');
  const landed = JSON.parse(await s.run(`JSON.stringify({ url: location.href, h: JSON.parse(document.body.innerText)['x-headerdial'] })`));
  assert.deepStrictEqual(landed, { url: A + '/echo/page?q=1', h: 'on' });
  const viaFetch = JSON.parse(await s.run(`fetch('/old/api').then((r) => JSON.stringify({ url: r.url, redirected: r.redirected }))`));
  assert.deepStrictEqual(viaFetch, { url: A + '/echo/api', redirected: true });
  // Regex mode with a group in the target.
  st = await s.setState(`p.redirects = [HeaderDial.newRedirect({ mode: 'regex', from: '^http://127\\\\.0\\\\.0\\\\.1:(\\\\d+)/api/v1/(.*)$', to: 'http://127.0.0.1:\\\\1/echo/v2/\\\\2' })];`);
  assert.deepStrictEqual(st.problems, [], 'regex redirect accepted: ' + JSON.stringify(st.problems));
  await s.go(A + '/api/v1/users?id=3');
  assert.strictEqual(await s.run('location.href'), A + '/echo/v2/users?id=3');
  await s.setState(`p.redirects = [];`);
  ok('Firefox: URL redirect (text and regex with groups) applies to page loads and fetch(), and headers still apply');

  // Cookie rows: Send appends to the browser's Cookie header, Store saves via Set-Cookie.
  await s.go(A + '/');
  await s.run(`(document.cookie = 'pre=0; Path=/', document.cookie = 'dup=browser; Path=/', 1)`);
  st = await s.setState(`p.cookies = [HeaderDial.newCookie('request', { name: 'hd', value: '1' }), HeaderDial.newCookie('request', { name: 'dup', value: 'ext' })];`);
  assert.deepStrictEqual(st.problems, [], 'cookie rule accepted: ' + JSON.stringify(st.problems));
  got = await s.echo();
  assert.strictEqual(got.cookie, 'pre=0; dup=browser; hd=1; dup=ext', 'Firefox Cookie header: ' + got.cookie);
  st = await s.setState(`p.cookies = [HeaderDial.newCookie('response', { name: 'hd', value: '1' }), HeaderDial.newCookie('response', { name: 'dup', value: 'ext' })];`);
  assert.deepStrictEqual(st.problems, [], 'set-cookie rule accepted: ' + JSON.stringify(st.problems));
  await s.go(A + '/');
  await s.run(`fetch('/echo?store').then(() => 1)`);
  const jar = await s.run('document.cookie');
  assert.match(jar, /(^|; )hd=1(;|$)/, 'Firefox stored hd: ' + jar);
  assert.match(jar, /(^|; )dup=ext(;|$)/, 'Firefox dup replaced: ' + jar);
  await s.setState(`p.cookies = [];`);
  await s.go(A + '/');
  await s.run(`(['pre', 'dup', 'hd'].forEach((c) => { document.cookie = c + '=; Max-Age=0; Path=/'; }), 1)`);
  ok('Firefox: cookie rows (Send appends to the Cookie header, Store saves via Set-Cookie)');

  // Firefox rejects a rule with an empty "set" value; only that row may be lost.
  st = await s.setState(`p.headers.push(HeaderDial.newHeader('request', { name: 'X-Empty', value: '' }));`);
  assert.strictEqual(st.problems.length, 1, JSON.stringify(st.problems));
  assert.match(st.problems[0].message, /X-Empty.*cannot send an empty value/);
  got = await s.echo();
  assert.strictEqual(got['x-headerdial'], 'on', 'the other headers still apply');
  await s.setState(`p.headers = p.headers.filter((h) => h.name !== 'X-Empty');`);
  ok('Firefox: an empty header value skips only that row, not the whole profile');

  // Guide guard: guides/headers-browsers-wont-let-you-change.html and override-content-type-header.html
  // say Firefox ignores a response "set" over an existing Content-Type, but adds a new header fine.
  await s.go(A + '/');
  st = await s.setState(`p.headers.push(HeaderDial.newHeader('response', { name: 'Content-Type', value: 'text/plain' }));`);
  assert.deepStrictEqual(st.problems.filter((x) => !/X-Empty/.test(x.message)), []);
  const ct = JSON.parse(await s.run(`fetch('${A}/echo?ct').then((r) => JSON.stringify({ ct: r.headers.get('content-type'), x: r.headers.get('x-served-by') }))`));
  assert.strictEqual(ct.x, 'headerdial', 'the same profile\'s new response header still applies');
  assert.strictEqual(ct.ct, 'application/json', 'Firefox still ignores a set over an existing Content-Type (guide claim)');
  await s.setState(`p.headers = p.headers.filter((h) => h.name !== 'Content-Type');`);
  ok('Firefox: guide claim holds, a response set over an existing Content-Type is ignored');

  // A "Never on" URL filter in an upper profile must not switch off the profile below it,
  // and a "Page domain" filter matches requests made by pages on that site only.
  {
    const B = A.replace('127.0.0.1', 'localhost');
    const orig = await s.run(`chrome.storage.local.get('state').then((x) => JSON.stringify(x.state.profiles))`);
    st = await s.setState(`s.profiles = [
      HeaderDial.newProfile(0, { name: 'Excluding', filters: [HeaderDial.newFilter('exclude', { value: '*skip*' })],
        headers: [HeaderDial.newHeader('request', { name: 'X-Upper', value: '1' }), HeaderDial.newHeader('request', { name: 'X-Both', value: 'upper' })] }),
      HeaderDial.newProfile(1, { name: 'Lower', headers: [HeaderDial.newHeader('request', { name: 'X-Lower', value: '1' }),
        HeaderDial.newHeader('request', { name: 'X-Both', value: 'lower' })] }),
      HeaderDial.newProfile(2, { name: 'Page domain', filters: [HeaderDial.newFilter('include', { type: 'initiator', value: 'localhost' })],
        headers: [HeaderDial.newHeader('request', { name: 'X-From-Localhost', value: '1' })] })];`);
    assert.deepStrictEqual(st.problems, [], 'no rule rejected: ' + JSON.stringify(st.problems));
    await s.go(A + '/echo?skip');
    let g = JSON.parse(await s.run('document.body.innerText'));
    assert.deepStrictEqual([g['x-upper'], g['x-lower'], g['x-both']], [undefined, '1', 'lower']);
    await s.go(A + '/echo?other');
    g = JSON.parse(await s.run('document.body.innerText'));
    assert.deepStrictEqual([g['x-upper'], g['x-lower'], g['x-both']], ['1', '1', 'upper']);
    ok('Firefox: a "Never on" URL filter in the upper profile leaves the lower profile on');
    assert.strictEqual(g['x-from-localhost'], undefined, 'typed address: no initiator');
    const from = async (page) => { await s.go(page + '/'); return s.run(`fetch('${A}/echo?pd').then((r) => r.json()).then((j) => j['x-from-localhost'] || 'none')`); };
    assert.strictEqual(await from(B), '1');
    assert.strictEqual(await from(A), 'none');
    ok('Firefox: "Page domain" filter: header on a fetch from a localhost page, not from another page or a typed address');
    await s.setState(`s.profiles = HeaderDial.normalizeState({ profiles: ${orig} }).profiles;`);
  }

  // Guide guard: guides/send-cookie-with-request.html has a table of what the server gets when a
  // Cookie header row and a Send cookie row sit in different profiles (browser has pre=0).
  {
    const orig = await s.run(`chrome.storage.local.get('state').then((x) => JSON.stringify(x.state.profiles))`);
    const setRow = `HeaderDial.newHeader('request', { name: 'Cookie', value: 'fixed=abc' })`;
    const rmRow = `HeaderDial.newHeader('request', { name: 'Cookie', value: '', op: 'remove' })`;
    const send = `cookies: [HeaderDial.newCookie('request', { name: 'hd', value: '1' })], headers: []`;
    const cases = [
      [`{ headers: [${setRow}] }`, `{ ${send} }`, 'fixed=abc; hd=1'],
      [`{ ${send} }`, `{ headers: [${setRow}] }`, 'fixed=abc'],
      [`{ headers: [${rmRow}] }`, `{ ${send} }`, 'hd=1'],
    ];
    await s.go(A + '/');
    await s.run(`(document.cookie = 'pre=0; Path=/', 1)`);
    for (const [left, right, want] of cases) {
      st = await s.setState(`s.profiles = [HeaderDial.newProfile(0, ${left}), HeaderDial.newProfile(1, ${right})];`);
      assert.deepStrictEqual(st.problems, [], JSON.stringify(st.problems));
      const got = (await s.echo()).cookie || 'none';
      assert.strictEqual(got, want, `Firefox, left ${left} / right ${right}: server got ${got}`);
    }
    await s.go(A + '/');
    await s.run(`(document.cookie = 'pre=; Max-Age=0; Path=/', 1)`);
    await s.setState(`s.profiles = HeaderDial.normalizeState({ profiles: ${orig} }).profiles;`);
    ok('Firefox: guide table holds for a Cookie header row and a Send row in different profiles');
  }

  // Recipes compile to rules Firefox accepts (the empty "remove" values and the timed Bearer row).
  {
    const orig = await s.run(`chrome.storage.local.get('state').then((x) => JSON.stringify(x.state.profiles))`);
    st = await s.setState(`s.profiles = [HeaderDial.newProfile(0)];
      for (const r of HeaderDial.RECIPES) HeaderDial.applyRecipe(s.profiles[0], r.key, { origin: '${A}' });
      s.profiles[0].headers.find((h) => h.name === 'Authorization').value = 'Bearer t0ken';`);
    assert.deepStrictEqual(st.problems, [], 'recipes accepted: ' + JSON.stringify(st.problems));
    const g = await s.echo();
    assert.deepStrictEqual([g['x-forwarded-for'], g.authorization, g.pragma], ['203.0.113.7', 'Bearer t0ken', 'no-cache']);
    await s.setState(`s.profiles = HeaderDial.normalizeState({ profiles: ${orig} }).profiles;`);
    ok('Firefox: every recipe compiles to rules Firefox accepts, and the request rows arrive');
  }

  // A DevTools-style curl command becomes a profile Firefox accepts (paste.js loads in the editor page).
  {
    const orig = await s.run(`chrome.storage.local.get('state').then((x) => JSON.stringify(x.state.profiles))`);
    const curl = JSON.stringify(`curl '${A}/api' \\\n  -H 'Authorization: Bearer ff-curl' \\\n  -H 'Accept: text/x-frozen' \\\n  -H 'Cookie: sid=frozen' \\\n  -H 'Sec-Fetch-Mode: cors' \\\n  -H $'X-Quote: it\\'s'`);
    st = await s.setState(`s.profiles = [HeaderDial.profileFromRequest(HeaderDial.parseRequestText(${curl}))];`);
    assert.deepStrictEqual(st.problems, [], JSON.stringify(st.problems));
    const g = await s.echo();
    assert.deepStrictEqual([g.authorization, g['x-quote']], ['Bearer ff-curl', "it's"]);
    assert.notStrictEqual(g.accept, 'text/x-frozen');
    assert.ok(!String(g.cookie || '').includes('sid=frozen'));
    await s.setState(`s.profiles = HeaderDial.normalizeState({ profiles: ${orig} }).profiles;`);
    ok('Firefox: a pasted curl command becomes a profile with only the non-browser headers, and they arrive');
  }

  // Guide guard (allow-iframe-x-frame-options.html): removing X-Frame-Options alone still blocks
  // a page that also sends CSP frame-ancestors; removing both loads it.
  {
    const orig = await s.run(`chrome.storage.local.get('state').then((x) => JSON.stringify(x.state.profiles))`);
    const B = A.replace('127.0.0.1', 'localhost');
    const frame = async (names) => {
      st = await s.setState(`s.profiles = [HeaderDial.newProfile(0, { headers: ${JSON.stringify(names)}.map((n) => HeaderDial.newHeader('response', { name: n, op: 'remove' })) })];`);
      assert.deepStrictEqual(st.problems, [], JSON.stringify(st.problems));
      await s.go(B + '/');
      return s.run(`(async () => {
      const f = document.createElement('iframe');
      const got = new Promise((r) => { addEventListener('message', (e) => e.data === 'framed-loaded' && r('loads')); setTimeout(() => r('blocked'), 2500); });
      f.src = '${A}/framed'; document.body.append(f);
      const out = await got; f.remove(); return out;
    })()`);
    };
    assert.strictEqual(await frame([]), 'blocked', 'control: the page refuses to be framed');
    assert.strictEqual(await frame(['X-Frame-Options']), 'blocked', 'frame-ancestors still blocks it');
    assert.strictEqual(await frame(['X-Frame-Options', 'Content-Security-Policy']), 'loads');
    await s.setState(`s.profiles = HeaderDial.normalizeState({ profiles: ${orig} }).profiles;`);
    ok('Firefox: guide claim holds, framing needs both X-Frame-Options and CSP frame-ancestors removed');
  }

  // Pause.
  st = await s.setState(`s.paused = true; p.filters = [];`);
  got = await s.echo();
  assert.strictEqual(got['x-headerdial'], undefined);
  ok('Firefox: global pause removes every change');

  // The editor page itself loads without errors and renders the profile.
  await s.setState(`s.paused = false;`);
  const rows = await s.run(`document.querySelectorAll('#req-rows .hrow').length`);
  assert.ok(rows >= 3, 'editor rendered ' + rows + ' request rows');
  ok('Firefox: editor page renders saved profiles');

  const cmds = JSON.parse(await s.run(`chrome.commands.getAll().then(JSON.stringify)`));
  const pauseCmd = cmds.find((c) => c.name === 'toggle-pause');
  assert.ok(pauseCmd && /Alt\+Shift\+D/.test(pauseCmd.shortcut), 'toggle-pause shortcut: ' + JSON.stringify(cmds));
  ok('Firefox: Alt+Shift+D pause shortcut is registered');

  await s.cleanup();
  srv.close();
  fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  console.log(`\n${passed} Firefox checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
