// Build = copy. No bundler or transpiler: the shipped extension is byte-for-byte the
// files in extension/, so anyone can compare a store build with this repository.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'), dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from, { withFileTypes: true })) {
    if (f.isDirectory()) copyDir(path.join(from, f.name), path.join(to, f.name));
    else fs.copyFileSync(path.join(from, f.name), path.join(to, f.name));
  }
}

const ext = path.join(dist, 'extension'), site = path.join(dist, 'site');
copyDir(path.join(root, 'extension'), ext);
copyDir(path.join(root, 'site'), site);
// The share page decodes links with the same code the extension uses.
fs.mkdirSync(path.join(site, 'js'), { recursive: true });
for (const f of ['model.js', 'transfer.js']) fs.copyFileSync(path.join(root, 'extension/lib', f), path.join(site, 'js', f));
fs.copyFileSync(path.join(root, 'extension/icons/128.png'), path.join(site, 'icon.png'));
fs.copyFileSync(path.join(root, 'extension/icons/32.png'), path.join(site, 'favicon.png'));

fs.copyFileSync(path.join(root, 'store/screenshot-1-editor.png'), path.join(site, 'screenshot.png'));

// sitemap.xml + robots.txt for every indexable page.
const BASE = 'https://janwan2003.github.io/request-headers/';
const pages = [];
(function walk(dir, rel) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) walk(path.join(dir, f.name), rel + f.name + '/');
    else if (f.name.endsWith('.html')) {
      const html = fs.readFileSync(path.join(dir, f.name), 'utf8');
      if (!/name="robots" content="noindex"/.test(html)) pages.push(rel + (f.name === 'index.html' ? '' : f.name));
    }
  }
})(site, '');
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(site, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  pages.sort().map((p) => `  <url><loc>${BASE}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n') + '\n</urlset>\n');
fs.writeFileSync(path.join(site, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE}sitemap.xml\n`);
fs.writeFileSync(path.join(site, '.nojekyll'), '');

const version = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')).version;
const zip = path.join(dist, `headerdial-${version}.zip`);
try {
  execFileSync('zip', ['-qrX', zip, '.'], { cwd: ext });
  fs.mkdirSync(path.join(site, 'download'), { recursive: true });
  fs.copyFileSync(zip, path.join(site, 'download', 'headerdial.zip'));
  console.log('built', path.relative(root, zip));
} catch (e) {
  console.warn('zip not available; skipped extension archive');
}
console.log('built dist/extension and dist/site');
