// Checks the built site: every relative link and asset in every HTML page resolves to a
// file in dist/site, every page has a title, description and canonical URL, and no page
// offers a manual install.
'use strict';
const fs = require('fs'), path = require('path');
const site = path.join(__dirname, '..', 'dist/site');
let pages = 0, links = 0;
const errors = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) { walk(full); continue; }
    if (!f.name.endsWith('.html')) continue;
    pages++;
    const html = fs.readFileSync(full, 'utf8');
    const rel = path.relative(site, full);
    for (const need of [/<title>[^<]+<\/title>/, /<meta name="description" content="[^"]+"/, /<link rel="canonical"/]) {
      if (!need.test(html)) errors.push(`${rel}: missing ${need.source.slice(0, 30)}`);
    }
    // Studio charter: install only from real stores. No page may offer a manual-install file
    // or walk visitors through loading one by hand (those belong in GitHub releases only).
    if (/(?:href|src)="[^"]+\.(?:zip|xpi|crx|vsix)"/i.test(html)) errors.push(`${rel}: links a manual-install file`);
    if (/Load unpacked|Load Temporary Add-on/i.test(html)) errors.push(`${rel}: tells visitors to install by hand`);
    for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const url = m[1];
      if (/^(https?:|mailto:|#|data:)/.test(url)) continue;
      links++;
      let target = path.resolve(path.dirname(full), url.split('#')[0].split('?')[0]);
      if (url.endsWith('/') || (fs.existsSync(target) && fs.statSync(target).isDirectory())) target = path.join(target, 'index.html');
      if (!fs.existsSync(target)) errors.push(`${rel}: broken link ${url}`);
    }
  }
})(site);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`site ok: ${pages} pages, ${links} relative links resolve`);
