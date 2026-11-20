// Measure exact CORS console texts in Chrome (Playwright + CDP Log) and Firefox (WebDriver BiDi
// log.entryAdded + a chrome-scope Services.console listener).
// Usage: node test/measure-cors-messages.js [chrome|firefox|both] [runs]   (writes .tmp/cors-measure/results.json;
// test/fixtures/cors-messages.json was made from that file, one entry per scenario and browser, ports normalised)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.OUT || path.join(ROOT, '.tmp', 'cors-measure');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome');
const FIREFOX = process.env.FIREFOX || 'firefox';
const which = process.argv[2] || 'both';
const RUNS = Number(process.argv[3] || 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILEDIR = path.join(OUT, 'filepage');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// One handler, bound on 127.0.0.1, 127.0.0.2 and ::1 at the same port: the page is
// http://127.0.0.1:P, the API http://localhost:P, a third origin http://127.0.0.2:P.
function handler(P) {
  const O = `http://127.0.0.1:${P}`;
  return (req, res) => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname, m = req.method;
    const send = (status, headers, body = '') => {
      res.writeHead(status, { 'cache-control': 'no-store', ...headers });
      res.end(body);
    };
    const json = { 'content-type': 'application/json' };
    const pre = (extra) => send(204, extra);
    switch (p) {
      case '/favicon.ico': return send(204, {});
      case '/page.html': return send(200, { 'content-type': 'text/html' }, '<!doctype html><title>p</title><h1>page</h1>');
      case '/nocors': return send(200, json, '{"ok":1}');
      case '/s1': return send(200, { ...json, 'access-control-allow-origin': 'http://example.com' }, '{}');
      case '/s2a': return send(200, { ...json, 'access-control-allow-origin': `${O}, http://example.com` }, '{}');
      case '/s2b': res.setHeader('access-control-allow-origin', [O, 'http://example.com']); return send(200, json, '{}');
      case '/s3-301': case '/s3-302':
        if (m === 'OPTIONS') return send(p.endsWith('301') ? 301 : 302, { location: '/s3target' });
        return send(200, { ...json, 'access-control-allow-origin': O }, '{}');
      case '/s3target':
        if (m === 'OPTIONS') return pre({ 'access-control-allow-origin': O, 'access-control-allow-methods': 'PUT', 'access-control-allow-headers': 'content-type' });
        return send(200, { ...json, 'access-control-allow-origin': O }, '{}');
      case '/s4a': return send(302, { location: `http://127.0.0.2:${P}/star` });
      case '/s4b': return send(302, { location: `http://127.0.0.2:${P}/star`, 'access-control-allow-origin': '*' });
      case '/s4c': return send(302, { location: `http://127.0.0.2:${P}/nocors`, 'access-control-allow-origin': '*' });
      case '/s4d': return send(302, { location: `http://127.0.0.2:${P}/exact`, 'access-control-allow-origin': O });
      case '/star': return send(200, { ...json, 'access-control-allow-origin': '*' }, '{}');
      case '/exact': return send(200, { ...json, 'access-control-allow-origin': O }, '{}');
      case '/s7': return send(200, { ...json, 'access-control-allow-origin': O, 'access-control-allow-credentials': 'false' }, '{}');
      case '/s7b': return send(200, { ...json, 'access-control-allow-origin': O, 'access-control-allow-credentials': 'TRUE' }, '{}');
      case '/s7c': return send(200, { ...json, 'access-control-allow-origin': O }, '{}');
      case '/s7d': return send(200, { ...json, 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' }, '{}');
      case '/s8':
        if (m === 'OPTIONS') return pre({ 'access-control-allow-origin': O, 'access-control-allow-methods': 'PUT', 'access-control-allow-headers': 'Content-Type' });
        return send(200, { ...json, 'access-control-allow-origin': O, 'access-control-allow-credentials': 'true' }, '{}');
      case '/s10':
        if (m === 'OPTIONS') return pre({ 'access-control-allow-origin': O, 'access-control-allow-headers': 'Content-Type' });
        return send(200, { ...json, 'access-control-allow-origin': O }, '{}');
      case '/mod.js': return send(200, { 'content-type': 'text/javascript' }, 'export default 1;');
      case '/font.woff2': return send(200, { 'content-type': 'font/woff2' }, Buffer.alloc(64));
      case '/pna': return send(200, { ...json, 'access-control-allow-origin': '*' }, '{}');
      default: return send(404, { 'content-type': 'text/plain' }, 'nf');
    }
  };
}

async function serveAll(P) {
  const h = handler(P);
  const servers = [];
  for (const host of ['127.0.0.1', '127.0.0.2', '::1']) {
    const s = http.createServer(h);
    await new Promise((r, j) => { s.once('error', j); s.listen(P, host, r); });
    servers.push(s);
  }
  return servers;
}

// Page-side helpers; API = http://localhost:P, CLOSED = a closed port.
const PRELUDE = `
const f = async (url, init) => { try { const r = await fetch(url, init); return 'RESOLVED status=' + r.status + ' type=' + r.type; } catch (e) { return e.name + ': ' + e.message; } };
`;

function scenarios(P, CLOSED) {
  const API = `http://localhost:${P}`;
  const put = (url, extra = {}) => `f(${JSON.stringify(url)}, Object.assign({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' }, ${JSON.stringify(extra)}))`;
  return [
    { id: 's0-baseline-missing-acao', code: `f('${API}/nocors')` },
    { id: 's1-acao-other-origin', code: `f('${API}/s1')` },
    { id: 's2a-acao-two-values-one-line', code: `f('${API}/s2a')` },
    { id: 's2b-acao-two-header-lines', code: `f('${API}/s2b')` },
    { id: 's3a-preflight-301', code: put(`${API}/s3-301`) },
    { id: 's3b-preflight-302', code: put(`${API}/s3-302`) },
    { id: 's4a-redirect-noacao-to-star', code: `f('${API}/s4a')`, notes: '302 from localhost has no ACAO; target 127.0.0.2 has ACAO *' },
    { id: 's4b-redirect-star-to-star', code: `f('${API}/s4b')`, notes: '302 has ACAO *; target 127.0.0.2 has ACAO *' },
    { id: 's4c-redirect-star-to-noacao', code: `f('${API}/s4c')`, notes: '302 has ACAO *; target 127.0.0.2 has no ACAO' },
    { id: 's4d-redirect-exact-to-exact', code: `f('${API}/s4d')`, notes: '302 has ACAO exact page origin; target 127.0.0.2 has ACAO exact page origin (tainted origin => request Origin becomes null)' },
    { id: 's5a-file-page-fetch-file', page: 'file', code: `f(${JSON.stringify('file://' + path.join(FILEDIR, 'data.json'))})` },
    { id: 's5b-file-page-fetch-http-nocors', page: 'file', code: `f('${API}/nocors')` },
    { id: 's6a-xhr-missing-acao', code: `new Promise((res) => { const x = new XMLHttpRequest(); x.open('GET', '${API}/nocors'); x.onload = () => res('load status=' + x.status); x.onerror = (e) => res('error event, status=' + x.status + ' readyState=' + x.readyState); x.send(); })` },
    { id: 's6b-module-script-missing-acao', code: `new Promise((res) => { const s = document.createElement('script'); s.type = 'module'; s.src = '${API}/mod.js'; s.onerror = () => res('script error event'); s.onload = () => res('script load event'); document.head.append(s); })` },
    { id: 's6c-font-face-missing-acao', code: `(async () => { const st = document.createElement('style'); st.textContent = "@font-face{font-family:XF;src:url('${API}/font.woff2') format('woff2')}"; document.head.append(st); const d = document.createElement('div'); d.style.fontFamily = 'XF'; d.textContent = 'hello'; document.body.append(d); try { const r = await document.fonts.load('16px XF'); await new Promise((r) => setTimeout(r, 300)); return 'fonts.load resolved, faces=' + r.length + ', statuses=' + [...document.fonts].map((x) => x.status).join(','); } catch (e) { return e.name + ': ' + e.message; } })()` },
    { id: 's7a-cred-acac-false', code: `f('${API}/s7', { credentials: 'include' })` },
    { id: 's7b-cred-acac-TRUE-uppercase', code: `f('${API}/s7b', { credentials: 'include' })` },
    { id: 's7c-cred-acac-missing', code: `f('${API}/s7c', { credentials: 'include' })` },
    { id: 's7d-cred-acao-star', code: `f('${API}/s7d', { credentials: 'include' })` },
    { id: 's8-preflight-cred-no-acac', code: put(`${API}/s8`, { credentials: 'include' }) },
    { id: 's9a-connection-refused-localhost', code: `f('http://localhost:${CLOSED}/x')` },
    { id: 's9b-connection-refused-same-host', code: `f('http://127.0.0.1:${CLOSED}/x')`, notes: 'same host, different (closed) port: still cross-origin' },
    { id: 's10-preflight-x-custom-not-allowed', code: `f('${API}/s10', { headers: { 'X-Custom': '1' } })` },
  ];
}

function normalize(s, P, CLOSED) {
  if (typeof s !== 'string') return s;
  return s.split(String(CLOSED)).join('CLOSEDPORT').split(String(P)).join('PORT').split(FILEDIR).join('FILEDIR');
}

// ---------------- Chrome ----------------
async function runChrome(P, CLOSED, list) {
  const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true });
  const version = browser.version();
  const out = [];
  for (const sc of list) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const pw = [], cdp = [];
      page.on('console', (m) => pw.push({ type: m.type(), text: m.text() }));
      page.on('pageerror', (e) => pw.push({ type: 'pageerror', text: String(e && e.message) }));
      const s = await ctx.newCDPSession(page);
      s.on('Log.entryAdded', ({ entry }) => cdp.push({ source: entry.source, level: entry.level, text: entry.text, url: entry.url }));
      await s.send('Log.enable');
      await page.goto(sc.page === 'file' ? 'file://' + path.join(FILEDIR, 'page.html') : `http://127.0.0.1:${P}/page.html`);
      const exception = await page.evaluate(PRELUDE + sc.code);
      await sleep(600);
      runs.push({ consoleMessages: pw.map((x) => x.text), consoleTypes: pw.map((x) => x.type), cdpLogEntries: cdp, exception });
      await ctx.close();
    }
    out.push(entry(sc, 'chrome', version, runs, P, CLOSED));
    process.stderr.write(`chrome ${sc.id} done\n`);
  }
  await browser.close();
  return out;
}

function entry(sc, browser, version, runs, P, CLOSED) {
  const key = (r) => JSON.stringify([r.consoleMessages, r.exception]);
  const stable = runs.every((r) => key(r) === key(runs[0]));
  const r0 = runs[0];
  return {
    scenario: sc.id, browser, browserVersion: version,
    consoleMessages: r0.consoleMessages, exception: r0.exception,
    normalized: { consoleMessages: r0.consoleMessages.map((m) => normalize(m, P, CLOSED)), exception: normalize(r0.exception, P, CLOSED) },
    stableAcrossRuns: stable, runCount: runs.length,
    notes: [sc.notes, `PORT=${P}, CLOSEDPORT=${CLOSED}`].filter(Boolean).join('; '),
    runs,
  };
}

// ---------------- Firefox ----------------
async function launchFirefox() {
  const profile = fs.mkdtempSync(path.join(OUT, 'fx-prof-'));
  fs.writeFileSync(path.join(profile, 'user.js'), [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("devtools.jsonview.enabled", false);',
  ].join('\n') + '\n');
  const port = await freePort();
  const proc = spawn(FIREFOX, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), '--remote-allow-system-access'],
    { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
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
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.type === 'error') reject(new Error(m.error + ': ' + m.message)); else resolve(m.result);
    } else if (m.type === 'event') events.push(m);
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const sess = await send('session.new', { capabilities: {} });
  const close = async () => {
    try { await send('browser.close', {}); } catch (e) { /* socket closes as Firefox exits */ }
    ws.close();
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(10000)]);
    if (proc.exitCode == null) proc.kill();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  };
  return { send, events, close, version: sess.capabilities.browserVersion };
}

const FX_LISTENER = `(() => {
  if (!globalThis.__corsLog) {
    globalThis.__corsLog = [];
    Services.console.registerListener({ observe(m) {
      if (m instanceof Ci.nsIScriptError) globalThis.__corsLog.push({ msg: m.errorMessage, cat: m.category, flags: m.flags, src: m.sourceName, win: m.innerWindowID });
      else globalThis.__corsLog.push({ msg: m.message, cat: 'nsIConsoleMessage' });
    } });
  }
  return 'ok';
})()`;

async function runFirefox(P, CLOSED, list) {
  const b = await launchFirefox();
  const { contexts: chromeCtx } = await b.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
  const chrome = chromeCtx[0].context;
  const evalChrome = async (expr) => (await b.send('script.evaluate', { expression: expr, target: { context: chrome }, awaitPromise: true, 'moz:scope': 'chrome' })).result.value;
  await evalChrome(FX_LISTENER);
  await b.send('session.subscribe', { events: ['log.entryAdded'] });
  const out = [];
  for (const sc of list) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const { userContext } = await b.send('browser.createUserContext', {});
      const { context } = await b.send('browsingContext.create', { type: 'tab', userContext });
      const url = sc.page === 'file' ? 'file://' + path.join(FILEDIR, 'page.html') : `http://127.0.0.1:${P}/page.html`;
      await b.send('browsingContext.navigate', { context, url, wait: 'complete' });
      await sleep(200);
      await evalChrome('globalThis.__corsLog.length = 0');
      b.events.length = 0;
      const r = await b.send('script.evaluate', { expression: PRELUDE + sc.code, target: { context }, awaitPromise: true });
      const exception = r.type === 'success' ? r.result.value : 'EVAL EXCEPTION: ' + JSON.stringify(r.exceptionDetails && r.exceptionDetails.text);
      await sleep(800);
      const all = JSON.parse(await evalChrome('JSON.stringify(globalThis.__corsLog)'));
      const bidi = b.events.filter((e) => e.method === 'log.entryAdded').map((e) => ({ type: e.params.type, level: e.params.level, text: e.params.text, context: e.params.source && e.params.source.context }));
      // Keep content messages only (drop browser-chrome noise that has no window id / chrome sources).
      // Drop browser-internal noise: plain nsIConsoleMessage (e.g. Toolkit.Telemetry WARN lines) and chrome/resource sources.
      const content = all.filter((x) => x.cat !== 'nsIConsoleMessage' && !/^(chrome|resource|moz-extension):/.test(x.src || ''));
      runs.push({ consoleMessages: content.map((x) => x.msg), consoleCategories: content.map((x) => `${x.cat}/flags=${x.flags}`), bidiLogEntries: bidi, droppedConsoleServiceMessages: all.filter((x) => !content.includes(x)).map((x) => `[${x.cat}] ${x.msg}`.slice(0, 300)), exception });
      await b.send('browsingContext.close', { context });
      await b.send('browser.removeUserContext', { userContext });
    }
    out.push(entry(sc, 'firefox', b.version, runs, P, CLOSED));
    process.stderr.write(`firefox ${sc.id} done\n`);
  }
  await b.close();
  return out;
}

(async () => {
  fs.mkdirSync(FILEDIR, { recursive: true });
  fs.writeFileSync(path.join(FILEDIR, 'page.html'), '<!doctype html><title>file page</title><h1>file page</h1>');
  fs.writeFileSync(path.join(FILEDIR, 'data.json'), '{"ok":1}');
  const P = Number(process.env.PORT) || await freePort();
  const CLOSED = await freePort();
  const servers = await serveAll(P);
  const list = scenarios(P, CLOSED).filter((s) => !process.env.ONLY || new RegExp(process.env.ONLY).test(s.id));
  let results = [];
  try {
    if (which === 'chrome' || which === 'both') results = results.concat(await runChrome(P, CLOSED, list));
    if (which === 'firefox' || which === 'both') results = results.concat(await runFirefox(P, CLOSED, list));
  } finally {
    servers.forEach((s) => s.close());
  }
  const file = path.join(OUT, process.env.OUTFILE || `results-${which}.json`);
  fs.writeFileSync(file, JSON.stringify(results, null, 2));
  console.log('wrote', file, results.length, 'entries');
})().catch((e) => { console.error(e); process.exit(1); });
