// Makes the LevelDB fixtures in test/fixtures/ from a real Chromium: a throwaway test
// extension saves ModHeader-shaped profiles with chrome.storage.local (and, like older
// MV2 extensions, with window.localStorage), the browser is restarted so LevelDB
// compacts its log into a snappy-compressed .ldb table, then more is written to a new
// log. The fixture is the extension's real on-disk folder, not something we wrote.
// Usage: node test/make-leveldb-fixture.js   (env CHROME=/path/to/chrome)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const CHROME = process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome');
const out = path.join(__dirname, 'fixtures');

const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-fixture-ext-'));
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'fixture writer', version: '1', permissions: ['storage'],
  background: { service_worker: 'sw.js' },
}));
fs.writeFileSync(path.join(ext, 'sw.js'), '');
fs.writeFileSync(path.join(ext, 'page.html'), '<!doctype html><title>p</title>');

const profile = (title, extra) => Object.assign({
  title, shortTitle: title.slice(0, 1), backgroundColor: '#6b5b95', appendMode: false,
  headers: [{ enabled: true, name: 'Authorization', value: 'Bearer staging-token-' + title, comment: '' },
    { enabled: false, name: 'X-Debug', value: '1', comment: 'off for now' }],
  respHeaders: [{ enabled: true, name: 'Access-Control-Allow-Origin', value: '*', comment: '' }],
  filters: [{ enabled: true, type: 'urls', urlRegex: '.*://api\\.example\\.com/.*' }],
  urlReplacements: [], cookieHeaders: [], setCookieHeaders: [],
}, extra || {});

async function session(userDir, fn) {
  const ctx = await chromium.launchPersistentContext(userDir, {
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/page.html`);
  await fn(page);
  await page.close();
  await ctx.close();
  return id;
}

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-fixture-prof-'));
  // Session 1: an early save, overwritten later (the reader must keep the newest value).
  await session(userDir, (p) => p.evaluate(async (old) => {
    await chrome.storage.local.set({ profiles: [old], selectedProfile: 0 });
    localStorage.setItem('profiles', JSON.stringify([old]));
    // Fill LevelDB's 4 MiB write buffer; the next write (the removal) flushes the
    // memtable, old profile included, into an .ldb table.
    for (let i = 0; i < 4; i++) await chrome.storage.local.set({ churn: String(i).repeat(1100000) });
    await chrome.storage.local.remove('churn');
    localStorage.removeItem('churn');
  }, profile('Old name')));
  // Session 2 (after a restart, so session 1's log is now an .ldb table): the current data,
  // big enough that the log record spans more than one 32 KiB LevelDB block.
  const big = Array.from({ length: 900 }, (_, i) => ({ enabled: true, name: 'X-Bulk-' + i, value: 'v'.repeat(40), comment: '' }));
  const id = await session(userDir, (p) => p.evaluate(async (a) => {
    await chrome.storage.local.set({ profiles: a, selectedProfile: 1, unrelated: { theme: 'dark' } });
    await chrome.storage.local.remove('selectedProfile');
    localStorage.setItem('profiles', JSON.stringify(a.slice(0, 2)));
  }, [profile('Staging'), profile('Bulk', { headers: big }), profile('Append', { appendMode: true,
    cookieHeaders: [{ enabled: true, name: 'session', value: 'abc' }] })]));

  const dirs = {
    'chrome-storage-local': path.join(userDir, 'Default', 'Local Extension Settings', id),
    'chrome-local-storage': path.join(userDir, 'Default', 'Local Storage', 'leveldb'),
  };
  fs.rmSync(out, { recursive: true, force: true });
  for (const [name, dir] of Object.entries(dirs)) {
    const dest = path.join(out, name);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      if (f === 'LOCK' || f.startsWith('LOG')) continue; // empty lock file and text logs: not data
      fs.copyFileSync(path.join(dir, f), path.join(dest, f));
    }
    console.log(name, fs.readdirSync(dest).map((f) => `${f} (${fs.statSync(path.join(dest, f)).size})`).join(', '));
  }
  fs.writeFileSync(path.join(out, 'extension-id.txt'), id + '\n');
  fs.rmSync(userDir, { recursive: true, force: true });
  fs.rmSync(ext, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
