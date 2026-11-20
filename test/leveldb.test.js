// LevelDB reader, against folders written by a real Chromium (test/make-leveldb-fixture.js).
'use strict';
const test = require('node:test');
const assert = require('assert');
const fs = require('fs'), path = require('path');
const L = require('../extension/lib/leveldb.js');
require('../extension/lib/model.js');
const HD = require('../extension/lib/transfer.js');

const fx = (d) => fs.readdirSync(path.join(__dirname, 'fixtures', d))
  .map((name) => ({ name, dir: d, bytes: new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', d, name))) }));

test('chrome.storage.local folder: newest profiles win over the older copy in the .ldb table', () => {
  const r = L.findModHeaderProfiles(fx('chrome-storage-local'));
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.found.length, 1);
  const set = r.found[0];
  assert.strictEqual(set.key, 'profiles');
  assert.deepStrictEqual(set.profiles.map((p) => p.title), ['Staging', 'Bulk', 'Append']);
  // The 900-header profile was one log record spread over several 32 KiB blocks.
  assert.strictEqual(set.profiles[1].headers.length, 900);
  assert.strictEqual(set.profiles[1].headers[899].name, 'X-Bulk-899');
});

test('the .ldb table alone is read (snappy blocks), deleted keys stay deleted across files', () => {
  const files = fx('chrome-storage-local');
  const table = L.readLevelDB(files.filter((f) => f.name.endsWith('.ldb')));
  const keys = table.entries.map((e) => L.decodeEntry(e).key).sort();
  assert.deepStrictEqual(keys, ['churn', 'profiles', 'selectedProfile']);
  const old = table.entries.find((e) => L.decodeEntry(e).key === 'profiles');
  assert.strictEqual(JSON.parse(L.decodeEntry(old).text)[0].title, 'Old name');
  const churn = table.entries.find((e) => L.decodeEntry(e).key === 'churn');
  assert.strictEqual(churn.value.length, 1100002); // a 1.1 MB JSON string, decompressed intact
  const all = L.readLevelDB(files).entries.map((e) => L.decodeEntry(e).key).sort();
  assert.deepStrictEqual(all, ['profiles', 'unrelated']); // churn and selectedProfile were removed later
});

test('localStorage folder: origin-prefixed UTF-16 keys and string values', () => {
  const r = L.findModHeaderProfiles(fx('chrome-local-storage'));
  assert.strictEqual(r.found.length, 1);
  assert.match(r.found[0].origin, /^chrome-extension:\/\/[a-p]{32}$/);
  assert.deepStrictEqual(r.found[0].profiles.map((p) => p.title), ['Staging', 'Bulk']);
});

test('recovered profiles go through the normal ModHeader importer', () => {
  const [set] = L.findModHeaderProfiles(fx('chrome-storage-local')).found;
  const res = HD.parseImport(JSON.stringify(set.profiles));
  assert.strictEqual(res.source, 'ModHeader');
  const staging = res.profiles[0];
  assert.strictEqual(staging.name, 'Staging');
  assert.deepStrictEqual(staging.headers.map((h) => [h.target, h.name, h.enabled]),
    [['request', 'Authorization', true], ['request', 'X-Debug', false], ['response', 'Access-Control-Allow-Origin', true]]);
  assert.strictEqual(staging.filters[0].type, 'regex');
  assert.strictEqual(res.profiles[2].cookies[0].name, 'session');
});

test('snappy: literals and overlapping copies', () => {
  // "abcabcabcabc": length 12, literal "abc", then copy len 9 offset 3 (1-byte-offset form).
  const enc = new Uint8Array([12, (3 - 1) << 2, 97, 98, 99, 1 | ((9 - 4) << 2), 3]);
  assert.strictEqual(Buffer.from(L.snappy(enc)).toString(), 'abcabcabcabc');
  assert.throws(() => L.snappy(new Uint8Array([5, 1 | (1 << 2), 9])), /offset/);
});

test('damaged or unrelated files are reported, not thrown', () => {
  const r = L.findModHeaderProfiles([
    { name: '000009.ldb', bytes: new Uint8Array(100).fill(7) },
    { name: '000010.log', bytes: new Uint8Array(50).fill(255) },
    { name: 'CURRENT', bytes: new TextEncoder().encode('MANIFEST-000001\n') },
  ]);
  assert.deepStrictEqual(r.found, []);
  assert.match(r.errors.join('\n'), /000009\.ldb: not a LevelDB table/);
});
