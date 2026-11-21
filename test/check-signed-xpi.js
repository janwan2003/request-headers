// Checks a Mozilla-signed release file before it goes into a GitHub release: a real release
// Firefox installs it permanently (signature enforced, not as a temporary add-on), reports it
// signed and enabled; and, as a control, refuses the unsigned build the same way.
// Usage: node test/check-signed-xpi.js release/headerdial-firefox-<version>.xpi   (env FIREFOX)
'use strict';
const fs = require('fs'), path = require('path'), net = require('net');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const FIREFOX = process.env.FIREFOX || 'firefox';
const TMP = path.join(root, '.tmp'); // the snap-packaged Firefox has a private /tmp
fs.mkdirSync(TMP, { recursive: true });
const xpi = path.resolve(process.argv[2] || '');
if (!fs.existsSync(xpi)) { console.error('usage: node test/check-signed-xpi.js <file.xpi>'); process.exit(2); }

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function launch() {
  const profile = fs.mkdtempSync(path.join(TMP, 'fx-sig-'));
  fs.writeFileSync(path.join(profile, 'user.js'), 'user_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("browser.aboutwelcome.enabled", false);\n');
  const port = await freePort();
  const proc = spawn(FIREFOX, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), '--remote-allow-system-access'],
    { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
  await new Promise((resolve, reject) => {
    let err = '';
    const t = setTimeout(() => reject(new Error('Firefox did not start BiDi')), 60000);
    proc.stderr.on('data', (d) => { err += d; if (/WebDriver BiDi listening/.test(err)) { clearTimeout(t); resolve(); } });
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let next = 1; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.type === 'error' ? p.reject(new Error(m.error + ': ' + m.message)) : p.resolve(m.result); };
  const send = (method, params) => new Promise((resolve, reject) => { const id = next++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  await send('session.new', { capabilities: {} });
  const close = async () => {
    try { await send('browser.close', {}); } catch (e) { /* closing */ }
    ws.close();
    await new Promise((r) => { if (proc.exitCode != null) r(); else { proc.once('exit', r); setTimeout(r, 10000); } });
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  };
  return { send, close };
}

async function addonState(b, id) {
  const { contexts } = await b.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
  const r = await b.send('script.evaluate', {
    target: { context: contexts[0].context }, awaitPromise: true, resultOwnership: 'none',
    expression: `ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager.getAddonByID(${JSON.stringify(id)})
      .then(a => JSON.stringify(a && { version: a.version, signedState: a.signedState, isActive: a.isActive, temporary: a.temporarilyInstalled,
        signedOK: a.signedState >= ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs").AddonManager.SIGNEDSTATE_SIGNED }))`,
  });
  return JSON.parse(r.result.value);
}

(async () => {
  let failed = 0;
  const b = await launch();
  try {
    const { extension } = await b.send('webExtension.install', { extensionData: { type: 'archivePath', path: xpi }, 'moz:permanent': true });
    const s = await addonState(b, extension);
    console.log('signed file:', extension, JSON.stringify(s));
    if (!(s && s.signedOK && s.isActive && !s.temporary)) { failed++; console.log('not ok - signed file did not install as a signed, enabled, permanent add-on'); }
    else console.log('ok - release Firefox installs the signed file permanently and reports it signed');
  } catch (e) { failed++; console.log('not ok - signed file refused:', e.message); }
  await b.close();

  // Control: the unsigned build must be refused when installed the same way, or the check above proves nothing.
  const unsigned = fs.readdirSync(path.join(root, 'dist')).find((f) => /^headerdial-firefox-.*\.zip$/.test(f));
  if (unsigned) {
    const c = await launch();
    try {
      await c.send('webExtension.install', { extensionData: { type: 'archivePath', path: path.join(root, 'dist', unsigned) }, 'moz:permanent': true });
      failed++; console.log('not ok - control: the unsigned build was accepted too, so this Firefox does not enforce signatures');
    } catch (e) { console.log('ok - control: the unsigned build is refused (' + e.message.slice(0, 120) + ')'); }
    await c.close();
  }
  process.exit(failed ? 1 : 0);
})();
