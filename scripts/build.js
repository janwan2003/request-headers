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
for (const f of ['model.js', 'transfer.js', 'leveldb.js', 'paste.js']) fs.copyFileSync(path.join(root, 'extension/lib', f), path.join(site, 'js', f));
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

// Firefox build: the same files with a Firefox manifest. Firefox MV3 runs background
// scripts as an event page (no service worker), needs an add-on id, and requires the
// data-collection declaration for new AMO listings. optional_host_permissions needs 128.
const firefox = path.join(dist, 'firefox');
copyDir(ext, firefox);
const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
// AMO limits the name to 45 characters.
const fxMf = { ...mf, name: 'HeaderDial: Modify Request & Response Headers', background: { scripts: ['lib/model.js', 'lib/transfer.js', 'background.js'] } };
delete fxMf.minimum_chrome_version;
fxMf.browser_specific_settings = {
  gecko: { id: 'headerdial@plainbyte', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } },
};
fs.writeFileSync(path.join(firefox, 'manifest.json'), JSON.stringify(fxMf, null, 2) + '\n');

const version = mf.version;
const zip = path.join(dist, `headerdial-${version}.zip`);
const fxZip = path.join(dist, `headerdial-firefox-${version}.zip`);
try {
  execFileSync('zip', ['-qrX', zip, '.'], { cwd: ext });
  execFileSync('zip', ['-qrX', fxZip, '.'], { cwd: firefox });
  // No download on the site: per the studio charter, manual-install files go only to GitHub releases.
  console.log('built', path.relative(root, zip), 'and', path.relative(root, fxZip));
} catch (e) {
  console.warn('zip not available; skipped extension archive');
}
console.log('built dist/extension and dist/site');
