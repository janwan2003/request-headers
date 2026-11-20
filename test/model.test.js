'use strict';
const test = require('node:test');
const assert = require('node:assert');
const HD = require('../extension/lib/model.js');
require('../extension/lib/transfer.js');

const state = (profiles, extra) => HD.normalizeState(Object.assign({ profiles }, extra));
const hdr = (name, value, o) => Object.assign({ name, value }, o);

test('compiles one profile to one rule covering page loads too', () => {
  const out = HD.compile(state([{ headers: [hdr('X-Test', '1'), hdr('X-Resp', 'r', { target: 'response' })] }]));
  assert.strictEqual(out.dynamic.length, 1);
  const r = out.dynamic[0];
  assert.deepStrictEqual(r.action.requestHeaders, [{ header: 'X-Test', operation: 'set', value: '1' }]);
  assert.deepStrictEqual(r.action.responseHeaders, [{ header: 'X-Resp', operation: 'set', value: 'r' }]);
  assert.ok(r.condition.resourceTypes.includes('main_frame'), 'DNR skips main_frame unless listed');
  assert.strictEqual(out.liveCount, 2);
});

test('skips disabled, empty, invalid and expired headers; reports invalid ones', () => {
  const now = 1000;
  const out = HD.compile(state([{ headers: [hdr('A', '1', { enabled: false }), hdr('', 'x'), hdr('Bad Name', 'x'),
    hdr('Old', '1', { expiresAt: 999 }), hdr('Line', 'a\nb'), hdr('Ok', '1', { expiresAt: 5000 })] }]), { now });
  assert.deepStrictEqual(out.dynamic[0].action.requestHeaders.map((h) => h.header), ['Ok']);
  assert.strictEqual(out.problems.length, 2);
  assert.strictEqual(out.nextExpiry, 5000);
});

test('paused or inactive produces no rules', () => {
  assert.strictEqual(HD.compile(state([{ headers: [hdr('A', '1')] }], { paused: true })).dynamic.length, 0);
  assert.strictEqual(HD.compile(state([{ active: false, headers: [hdr('A', '1')] }])).dynamic.length, 0);
});

test('remove has no value; append on a non-appendable request header falls back to set', () => {
  const out = HD.compile(state([{ headers: [hdr('Cookie', '', { op: 'remove' }), hdr('X-Foo', 'v', { op: 'append' }),
    hdr('Accept-Language', 'pl', { op: 'append' })] }]));
  assert.deepStrictEqual(out.dynamic[0].action.requestHeaders, [
    { header: 'Cookie', operation: 'remove' },
    { header: 'X-Foo', operation: 'set', value: 'v' },
    { header: 'Accept-Language', operation: 'append', value: 'pl' }]);
  assert.strictEqual(out.problems.length, 1);
});

test('later duplicate rows win', () => {
  const out = HD.compile(state([{ headers: [hdr('X-A', '1'), hdr('x-a', '2')] }]));
  assert.deepStrictEqual(out.dynamic[0].action.requestHeaders, [{ header: 'x-a', operation: 'set', value: '2' }]);
});

test('filters: domains grouped, each pattern/regex its own rule, excludes', () => {
  const out = HD.compile(state([{
    headers: [hdr('A', '1')],
    filters: [
      { kind: 'include', type: 'domain', value: 'a.com' }, { kind: 'include', type: 'domain', value: 'B.com' },
      { kind: 'include', type: 'regex', value: '^https://x\\.dev/' }, { kind: 'include', type: 'pattern', value: '||y.dev^' },
      { kind: 'exclude', type: 'domain', value: 'skip.a.com' }, { kind: 'exclude', type: 'pattern', value: '*/health' },
      { kind: 'include', type: 'regex', value: '(', enabled: true },
    ],
    resourceTypes: ['xmlhttprequest'],
  }]));
  const mods = out.dynamic.filter((r) => r.action.type === 'modifyHeaders');
  assert.strictEqual(mods.length, 3);
  assert.deepStrictEqual(mods[0].condition.requestDomains, ['a.com', 'b.com']);
  assert.strictEqual(mods[1].condition.regexFilter, '^https://x\\.dev/');
  assert.strictEqual(mods[2].condition.urlFilter, '||y.dev^');
  for (const m of mods) {
    assert.deepStrictEqual(m.condition.excludedRequestDomains, ['skip.a.com']);
    assert.deepStrictEqual(m.condition.resourceTypes, ['xmlhttprequest']);
  }
  const allow = out.dynamic.find((r) => r.action.type === 'allow');
  assert.strictEqual(allow.condition.urlFilter, '*/health');
  assert.strictEqual(allow.priority, mods[0].priority + 1);
  assert.ok(out.problems.some((p) => /regular expression/.test(p.message)));
});

test('first profile has the highest priority; tab profiles become session rules; ids are unique', () => {
  const out = HD.compile(state([
    { headers: [hdr('A', '1')] },
    { headers: [hdr('A', '2')], tabId: 7 },
    { headers: [hdr('B', '1')], filters: [{ kind: 'exclude', type: 'regex', value: 'x' }] },
  ]));
  assert.strictEqual(out.session.length, 1);
  assert.deepStrictEqual(out.session[0].condition.tabIds, [7]);
  const all = out.dynamic.concat(out.session);
  assert.strictEqual(new Set(all.map((r) => r.id)).size, all.length);
  assert.ok(out.dynamic[0].priority > out.session[0].priority);
  const allowB = out.dynamic.find((r) => r.action.type === 'allow');
  assert.ok(allowB.priority < out.session[0].priority, 'exclusion of a lower profile must not override higher ones');
});

test('resource types the browser lacks are dropped', () => {
  const out = HD.compile(state([{ headers: [hdr('A', '1')] }]), { resourceTypes: ['main_frame', 'xmlhttprequest'] });
  assert.deepStrictEqual(out.dynamic[0].condition.resourceTypes, ['main_frame', 'xmlhttprequest']);
});

test('normalizeState repairs junk', () => {
  const s = HD.normalizeState({ profiles: [{ headers: [{ name: 5, op: 'zap', target: 'x' }], color: 'red', filters: 'no' }] });
  assert.strictEqual(s.profiles[0].headers[0].name, '5');
  assert.strictEqual(s.profiles[0].headers[0].op, 'set');
  assert.strictEqual(s.profiles[0].headers[0].target, 'request');
  assert.match(s.profiles[0].color, /^#/);
  assert.deepStrictEqual(s.profiles[0].filters, []);
  assert.strictEqual(HD.normalizeState(null).profiles.length, 1);
});

// Shape taken from a real ModHeader export published on GitHub (values changed).
const MODHEADER = JSON.stringify([
  { appendMode: false, backgroundColor: '#660000', filters: [{ comment: '', enabled: true, resourceType: [], type: 'urls', urlRegex: '.*://localhost:[35]000/.*' }],
    headers: [{ comment: '', enabled: true, name: 'X-User', value: 'alice' }, { comment: '', enabled: false, name: 'X-Off', value: '1' },
      { comment: '', enabled: true, name: 'Cookie', value: '' }],
    hideComment: true, respHeaders: [{ enabled: true, name: 'Access-Control-Allow-Origin', value: '*' }], shortTitle: 'A', title: 'Alice', urlReplacements: [] },
  { title: 'Tabs', headers: [{ enabled: true, name: 'X-T', value: '1' }], respHeaders: [],
    filters: [{ type: 'tabs', enabled: true }, { type: 'excludeUrls', urlRegex: '.*/health', enabled: true }, { type: 'resourceTypes', resourceType: ['xmlhttprequest'] }],
    urlReplacements: [{ name: 'a', value: 'b' }] },
]);

test('imports a ModHeader export', () => {
  const r = HD.parseImport(MODHEADER);
  assert.strictEqual(r.source, 'ModHeader');
  assert.strictEqual(r.profiles.length, 2);
  const [a, t] = r.profiles;
  assert.strictEqual(a.name, 'Alice');
  assert.strictEqual(a.color, '#660000');
  assert.deepStrictEqual(a.headers.map((h) => [h.target, h.name, h.op, h.enabled]), [
    ['request', 'X-User', 'set', true], ['request', 'X-Off', 'set', false], ['request', 'Cookie', 'remove', true],
    ['response', 'Access-Control-Allow-Origin', 'set', true]]);
  assert.deepStrictEqual(a.filters.map((f) => [f.kind, f.type, f.value]), [['include', 'regex', '.*://localhost:[35]000/.*']]);
  assert.deepStrictEqual(t.filters.map((f) => f.kind), ['exclude']);
  assert.deepStrictEqual(t.resourceTypes, ['xmlhttprequest']);
  assert.strictEqual(r.warnings.length, 1, r.warnings.join('\n')); // the "tabs" filter
  assert.deepStrictEqual(t.redirects.map((x) => [x.mode, x.from, x.to, x.enabled]), [['replace', 'a', 'b', true]]);
  // and the imported profiles compile: 2 header rules, 1 exclusion, 1 redirect
  assert.strictEqual(HD.compile(HD.normalizeState({ profiles: r.profiles })).dynamic.length, 4);
});

test('imports {profiles:[...]} and a single ModHeader profile object', () => {
  const one = JSON.parse(MODHEADER)[0];
  assert.strictEqual(HD.parseImport(JSON.stringify({ profiles: [one] })).profiles.length, 1);
  assert.strictEqual(HD.parseImport(JSON.stringify(one)).profiles.length, 1);
});

test('HeaderDial export and share link round-trip, with fresh ids', () => {
  const s = state([{ name: 'Staging ✓', headers: [hdr('Authorization', 'Bearer abc')], filters: [{ type: 'domain', value: 'api.dev' }] }]);
  const back = HD.parseImport(HD.exportJSON(s.profiles));
  assert.strictEqual(back.source, 'HeaderDial');
  assert.strictEqual(back.profiles[0].name, 'Staging ✓');
  assert.strictEqual(back.profiles[0].headers[0].value, 'Bearer abc');
  assert.notStrictEqual(back.profiles[0].id, s.profiles[0].id);
  const link = HD.shareLink(s.profiles[0]);
  assert.match(link, /^https:\/\/janwan2003\.github\.io\/request-headers\/share\/#p=[A-Za-z0-9_-]+$/);
  assert.strictEqual(HD.parseImport(link).profiles[0].filters[0].value, 'api.dev');
  assert.strictEqual(HD.parseImport(HD.shareLink(s.profiles[0], { blankValues: true })).profiles[0].headers[0].value, '');
});

test('import errors are readable', () => {
  assert.throws(() => HD.parseImport(''), /Nothing/);
  assert.throws(() => HD.parseImport('{oops'), /not valid JSON/);
  assert.throws(() => HD.parseImport('{"a":1}'), /Unrecognised/);
  assert.throws(() => HD.parseImport('https://example.com/'), /no HeaderDial profile/);
});

test('request-method filter: normalised, compiled into requestMethods, kept on export/import', () => {
  const s = state([{ headers: [hdr('A', '1')], requestMethods: ['POST', 'put', 'post', 'bogus'] }]);
  assert.deepStrictEqual(s.profiles[0].requestMethods, ['post', 'put']);
  const out = HD.compile(s);
  assert.deepStrictEqual(out.dynamic[0].condition.requestMethods, ['post', 'put']);
  assert.strictEqual(HD.compile(state([{ headers: [hdr('A', '1')] }])).dynamic[0].condition.requestMethods, undefined);
  const back = HD.parseImport(HD.exportJSON(s.profiles));
  assert.deepStrictEqual(back.profiles[0].requestMethods, ['post', 'put']);
});

test('redirects: replace mode escapes the text and keeps the rest of the URL', () => {
  const s = state([{ headers: [], redirects: [{ from: 'https://cdn.example.com/app.js?v=1', to: 'http://localhost:3000/app.js' }],
    filters: [{ kind: 'exclude', type: 'domain', value: 'skip.example.com' }], requestMethods: ['get'] }]);
  const out = HD.compile(s);
  assert.strictEqual(out.dynamic.length, 1);
  const r = out.dynamic[0];
  assert.deepStrictEqual(r.action, { type: 'redirect', redirect: { regexSubstitution: '\\1http://localhost:3000/app.js\\2' } });
  assert.strictEqual(r.condition.regexFilter, '^(.*?)https://cdn\\.example\\.com/app\\.js\\?v=1(.*)$');
  assert.deepStrictEqual(r.condition.excludedRequestDomains, ['skip.example.com']);
  assert.deepStrictEqual(r.condition.requestMethods, ['get']);
  assert.strictEqual(out.liveCount, 1);
  // what the browser will do with that rule, emulated with JS regex replacement
  const url = 'https://cdn.example.com/app.js?v=1&x=2';
  const js = r.action.redirect.regexSubstitution.replace(/\\(\d)/g, '$$$1');
  assert.strictEqual(url.replace(new RegExp(r.condition.regexFilter), js), 'http://localhost:3000/app.js&x=2');
});

test('redirects: regex mode passes through; problems are reported and skipped', () => {
  const ok = HD.compile(state([{ headers: [], redirects: [{ mode: 'regex', from: '^https://prod\\.example\\.com/(.*)', to: 'https://staging.example.com/\\1' }] }]));
  assert.deepStrictEqual(ok.dynamic[0].condition.regexFilter, '^https://prod\\.example\\.com/(.*)');
  assert.deepStrictEqual(ok.dynamic[0].action.redirect.regexSubstitution, 'https://staging.example.com/\\1');
  const bad = HD.compile(state([{ headers: [hdr('X-A', '1')], redirects: [
    { from: 'example.com/', to: 'example.com/v2/' }, // loops
    { mode: 'regex', from: '([', to: 'https://x/' },
    { mode: 'regex', from: '.*', to: 'localhost/' },
    { from: 'a', to: '' },
    { from: '', to: '' }, // blank row: ignored silently
    { from: 'off', to: 'x', enabled: false, mode: 'regex' },
  ] }]));
  assert.strictEqual(bad.dynamic.length, 1, 'only the header rule');
  assert.strictEqual(bad.dynamic[0].action.type, 'modifyHeaders');
  assert.deepStrictEqual(bad.problems.map((p) => p.message.split(': ')[1]), ['the target contains the text it replaces, so it would redirect forever',
    'invalid regular expression', 'the target must start with a scheme such as https:// or a group such as \\1', 'say where to redirect to']);
});

test('redirects survive export, share links and import, with fresh ids', () => {
  const s = state([{ headers: [], redirects: [{ from: 'prod.example.com', to: 'localhost:8080' }] }]);
  const back = HD.parseImport(HD.shareLink(s.profiles[0])).profiles[0];
  assert.deepStrictEqual(back.redirects.map((r) => [r.mode, r.from, r.to]), [['replace', 'prod.example.com', 'localhost:8080']]);
  assert.notStrictEqual(back.redirects[0].id, s.profiles[0].redirects[0].id);
  assert.deepStrictEqual(HD.normalizeState({ profiles: [{}] }).profiles[0].redirects, []);
});
