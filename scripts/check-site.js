// Checks the built site: every relative link and asset in every HTML page resolves to a
// file in dist/site, and every page has a title, description and canonical URL.
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
