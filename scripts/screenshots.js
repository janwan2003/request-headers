// Renders the editor with realistic sample profiles and saves screenshots for the
// store listing and the website. Usage: node scripts/screenshots.js <outdir>
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('playwright-core');
const out = path.resolve(process.argv[2] || 'store');
const CHROME = process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome');
const ext = path.join(__dirname, '..', 'dist/extension');

const SAMPLE = {
  schema: 1, paused: false, selectedId: 'stg',
  profiles: [
    { id: 'stg', name: 'Staging API', color: '#2563eb', active: true,
      headers: [
        { target: 'request', name: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.staging-token', expiresAt: Date.now() + 47 * 60000 + 30000 },
        { target: 'request', name: 'X-Feature-Flags', value: 'new-checkout,dark-mode' },
        { target: 'request', name: 'X-Forwarded-For', value: '203.0.113.42' },
        { target: 'request', name: 'Cookie', op: 'remove' },
        { target: 'response', name: 'Access-Control-Allow-Origin', value: 'http://localhost:3000' },
        { target: 'response', name: 'Access-Control-Allow-Credentials', value: 'true' },
      ],
      filters: [{ kind: 'include', type: 'domain', value: 'api.staging.example.com' }, { kind: 'exclude', type: 'pattern', value: '*/healthz' }] },
    { id: 'loc', name: 'Localhost debug', color: '#16a34a', active: true,
      headers: [{ target: 'request', name: 'X-Debug', value: '1' }, { target: 'response', name: 'Content-Security-Policy', op: 'remove' }],
      filters: [{ kind: 'include', type: 'pattern', value: '||localhost^' }] },
    { id: 'mob', name: 'Mobile UA', color: '#9333ea', active: false,
      headers: [{ target: 'request', name: 'User-Agent', value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }], filters: [] },
  ],
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'hd-shot-')), {
    executablePath: CHROME, headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    deviceScaleFactor: 1,
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const ui = await ctx.newPage();
  await ui.goto(`chrome-extension://${id}/popup.html`);
  await ui.evaluate(async (s) => { await chrome.storage.local.set({ state: s }); }, SAMPLE);
  // Popup as the browser shows it (620px wide), access banner hidden for the shot.
  await ui.setViewportSize({ width: 700, height: 600 });
  await ui.reload();
  await ui.addStyleTag({ content: '#access{display:none!important}' });
  await ui.waitForTimeout(300);
  const h = await ui.evaluate(() => document.body.scrollHeight);
  await ui.setViewportSize({ width: 700, height: Math.min(h, 600) });
  await ui.screenshot({ path: path.join(out, 'popup.png') });
  // 1280x800 store screenshot: the popup over a mock page.
  const popupPng = fs.readFileSync(path.join(out, 'popup.png')).toString('base64');
  const stage = await ctx.newPage();
  await stage.setViewportSize({ width: 1280, height: 800 });
  const frame = (title, sub) => `<!doctype html><body style="margin:0;width:1280px;height:800px;background:linear-gradient(135deg,#1e3a8a,#2563eb 60%,#60a5fa);font-family:system-ui,sans-serif;display:flex;align-items:center;gap:48px;padding:0 64px;box-sizing:border-box">
    <div style="color:#fff;flex:1"><div style="font-size:46px;font-weight:700;line-height:1.15">${title}</div><div style="font-size:22px;opacity:.9;margin-top:16px;line-height:1.4">${sub}</div></div>
    <img src="data:image/png;base64,${popupPng}" style="width:560px;border-radius:10px;box-shadow:0 20px 60px #0006"></body>`;
  await stage.setContent(frame('Change HTTP headers in one click', 'Request and response headers, profiles per environment, URL filters, headers that switch themselves off.'));
  await stage.screenshot({ path: path.join(out, 'screenshot-1-editor.png') });
  // Second shot: the import dialog after importing a ModHeader export.
  await ui.setViewportSize({ width: 700, height: 560 });
  await ui.click('#import');
  await ui.fill('#import-text', JSON.stringify([{ title: 'QA user', backgroundColor: '#ea580c', appendMode: false, shortTitle: 'Q',
    headers: [{ enabled: true, name: 'X-Test-User', value: 'qa-42', comment: '' }], respHeaders: [], urlReplacements: [],
    filters: [{ enabled: true, type: 'urls', urlRegex: '.*://qa\\.example\\.com/.*', resourceType: [], comment: '' }] }], null, 1));
  await ui.click('#import-go');
  await ui.fill('#import-text', '[\n {\n  "title": "QA user",\n  "headers": [ { "name": "X-Test-User", "value": "qa-42" } ],\n  "filters": [ { "type": "urls", "urlRegex": ".*://qa\\\\.example\\\\.com/.*" } ]\n }\n]');
  await ui.waitForTimeout(300);
  await ui.screenshot({ path: path.join(out, 'popup-import.png') });
  const importPng = fs.readFileSync(path.join(out, 'popup-import.png')).toString('base64');
  await stage.setContent(frame('Open source. No tracking.', 'No account, no analytics, no network requests. The code in the store is the code on GitHub. Imports your old ModHeader profiles.').replace(popupPng, importPng));
  await stage.screenshot({ path: path.join(out, 'screenshot-2-private.png') });
  await ctx.close();
  console.log('screenshots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
