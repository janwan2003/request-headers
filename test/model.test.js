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
  const top = out.dynamic.find((r) => r.action.requestHeaders && r.action.requestHeaders[0].value === '1' && r.action.requestHeaders[0].header === 'A');
  assert.ok(top.priority > out.session[0].priority);
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

test('emptyValues:false (Firefox) skips empty set rows instead of losing the whole rule', () => {
  const s = state([{ headers: [hdr('X-Empty', ''), hdr('X-Keep', '1'), hdr('X-Gone', '', { op: 'remove' })] }]);
  const chrome = HD.compile(s);
  assert.strictEqual(chrome.dynamic[0].action.requestHeaders.length, 3);
  const ff = HD.compile(s, { emptyValues: false });
  assert.deepStrictEqual(ff.dynamic[0].action.requestHeaders.map((h) => h.header), ['X-Keep', 'X-Gone']);
  assert.match(ff.problems[0].message, /^"X-Empty": this browser cannot send an empty value/);
  assert.strictEqual(ff.liveCount, 2);
});

test('cookie rows: request cookies become one Cookie append, response cookies one Set-Cookie each', () => {
  const out = HD.compile(state([{ headers: [hdr('X-A', '1')], cookies: [
    { name: 'a', value: '1' }, { name: 'b', value: ' 2 ' }, { name: 'off', value: 'x', enabled: false },
    { target: 'response', name: 's', value: 'v', attrs: '; Path=/; Max-Age=60' }, { target: 'response', name: 't', value: 'w', attrs: '' },
    { name: 'bad name', value: '1' }, { name: 'semi', value: 'a;b' }] }]));
  const a = out.dynamic[0].action;
  assert.deepStrictEqual(a.requestHeaders, [{ header: 'X-A', operation: 'set', value: '1' },
    { header: 'cookie', operation: 'append', value: 'a=1; b=2' }]);
  assert.deepStrictEqual(a.responseHeaders, [{ header: 'set-cookie', operation: 'append', value: 's=v; Path=/; Max-Age=60' },
    { header: 'set-cookie', operation: 'append', value: 't=w' }]);
  assert.strictEqual(out.liveCount, 5);
  assert.deepStrictEqual(out.problems.map((p) => p.message), ['cookie "bad name": invalid cookie name',
    'cookie "semi": a cookie value cannot contain ";" or a line break']);
});

test('cookie rows fold into a Cookie header row, so Cookie never gets two operations', () => {
  const ck = [{ name: 'a', value: '1' }];
  const one = (headers) => HD.compile(state([{ headers, cookies: ck }])).dynamic[0].action.requestHeaders;
  assert.deepStrictEqual(one([hdr('Cookie', 'x=9')]), [{ header: 'Cookie', operation: 'set', value: 'x=9; a=1' }]);
  assert.deepStrictEqual(one([hdr('Cookie', '', { op: 'remove' })]), [{ header: 'Cookie', operation: 'set', value: 'a=1' }]);
  assert.deepStrictEqual(one([hdr('Cookie', 'x=9', { op: 'append' })]), [{ header: 'Cookie', operation: 'append', value: 'x=9; a=1' }]);
  // A profile with only cookies still makes a rule.
  assert.strictEqual(HD.compile(state([{ headers: [], cookies: ck }])).dynamic.length, 1);
});

test('ModHeader cookieHeaders and setCookieHeaders import as cookie rows', () => {
  const res = HD.parseImport(JSON.stringify([{ title: 'C', headers: [],
    cookieHeaders: [{ enabled: true, name: 'session', value: 'abc' }],
    setCookieHeaders: [{ enabled: false, name: 'theme', value: 'dark; Path=/; Max-Age=600' }, { name: 'plain', value: '1' }] }]));
  const c = res.profiles[0].cookies.map(({ target, name, value, attrs, enabled }) => ({ target, name, value, attrs, enabled }));
  assert.deepStrictEqual(c, [{ target: 'request', name: 'session', value: 'abc', attrs: '', enabled: true },
    { target: 'response', name: 'theme', value: 'dark', attrs: 'Path=/; Max-Age=600', enabled: false },
    { target: 'response', name: 'plain', value: '1', attrs: 'Path=/', enabled: true }]);
  assert.deepStrictEqual(res.warnings, []);
  // Round trip through HeaderDial's own export keeps them.
  const again = HD.parseImport(HD.exportJSON(res.profiles));
  assert.deepStrictEqual(again.profiles[0].cookies.map((x) => x.name), ['session', 'theme', 'plain']);
});

test('curl command: headers quoted for the shell, removes as -H "Name:", cookies as -b, browser-only parts as comments', () => {
  const p = state([{ headers: [hdr('Authorization', "Bearer it's"), hdr('User-Agent', '', { op: 'remove' }),
    hdr('X-Off', '1', { enabled: false }), hdr('X-Resp', '1', { target: 'response' })],
  cookies: [{ name: 'a', value: '1' }, { name: 'b', value: '2' }], redirects: [{ from: '/old/', to: '/new/' }] }]).profiles[0];
  assert.strictEqual(HD.curlCommand(p, 'https://api.example.com/v1?x=1&y=2'),
    '# not in curl (browser only): response header set X-Resp\n' +
    '# not in curl (browser only): redirect /old/ -> /new/\n' +
    "curl 'https://api.example.com/v1?x=1&y=2' \\\n  -H 'Authorization: Bearer it'\\''s' \\\n  -H 'User-Agent:' \\\n  -b 'a=1; b=2'");
});

test('a "Never on" URL filter keeps lower profiles on: their rules are copied above the allow rule', () => {
  const out = HD.compile(state([
    { name: 'Top', headers: [hdr('X-Top', '1')] },
    { name: 'A', headers: [hdr('X-A', '1')], filters: [{ kind: 'exclude', type: 'pattern', value: '*/health' }] },
    { name: 'B', headers: [hdr('X-B', '1')], filters: [{ kind: 'include', type: 'domain', value: 'api.com' }], resourceTypes: ['xmlhttprequest'] },
  ]));
  const by = (h) => out.dynamic.filter((r) => r.action.requestHeaders && r.action.requestHeaders[0].header === h);
  const allow = out.dynamic.find((r) => r.action.type === 'allow');
  const [b, copy] = by('X-B').sort((x, y) => x.priority - y.priority);
  assert.ok(b.priority < allow.priority);
  assert.ok(copy.priority > allow.priority && copy.priority < by('X-Top')[0].priority);
  assert.deepStrictEqual(copy.condition, { resourceTypes: ['xmlhttprequest'], requestDomains: ['api.com'], urlFilter: '*/health' });
  assert.strictEqual(out.problems.length, 0);
});

test('lower profiles that cannot be copied get a warning; a profile with exclusions at the bottom needs none', () => {
  let out = HD.compile(state([
    { name: 'A', headers: [hdr('X-A', '1')], filters: [{ kind: 'exclude', type: 'pattern', value: '*/health' }] },
    { name: 'B', headers: [hdr('X-B', '1')], filters: [{ kind: 'include', type: 'pattern', value: '*/api/*' }] },
  ]));
  assert.strictEqual(out.problems.length, 1);
  assert.match(out.problems[0].message, /"A" has a "Never on" URL filter \(\*\/health\).*"B" has "Only on" URL filters, so it cannot be kept on there\. Move "A" below "B"/);
  out = HD.compile(state([
    { name: 'B', headers: [hdr('X-B', '1')], filters: [{ kind: 'include', type: 'pattern', value: '*/api/*' }] },
    { name: 'A', headers: [hdr('X-A', '1')], filters: [{ kind: 'exclude', type: 'pattern', value: '*/health' }] },
  ]));
  assert.strictEqual(out.problems.length, 0);
  assert.strictEqual(out.dynamic.length, 3);
});

test('"Page domain" filters become initiatorDomains / excludedInitiatorDomains on every rule of the profile', () => {
  const out = HD.compile(state([{ headers: [hdr('X', '1')], redirects: [{ from: 'a.js', to: 'b.js' }], filters: [
    { kind: 'include', type: 'initiator', value: 'LocalHost' },
    { kind: 'include', type: 'pattern', value: '||api.com^' },
    { kind: 'exclude', type: 'initiator', value: 'admin.localhost' },
    { kind: 'exclude', type: 'regex', value: 'x' },
    { kind: 'include', type: 'initiator', value: 'bad domain!' },
  ] }]));
  assert.strictEqual(out.dynamic.length, 3);
  for (const r of out.dynamic) {
    assert.deepStrictEqual(r.condition.initiatorDomains, ['localhost'], r.action.type);
    assert.deepStrictEqual(r.condition.excludedInitiatorDomains, ['admin.localhost'], r.action.type);
  }
  assert.strictEqual(out.dynamic.find((r) => r.action.type === 'modifyHeaders').condition.urlFilter, '||api.com^');
  assert.ok(out.problems.some((p) => /bad domain!.*example\.com/.test(p.message)));
});

// A small model of how browsers pick declarativeNetRequest rules for one request,
// enough for the filters below: rules above the highest matching allow rule apply,
// and for a header the highest-priority "set" wins.
function urlFilterRe(f) {
  let s = f.replace(/[.+?${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\^/g, '(?:[/?:]|$)');
  if (s.startsWith('||')) s = '^[a-z]+://(?:[^/]*\\.)?' + s.slice(2);
  return new RegExp(s);
}
const domainMatch = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));
function ruleMatches(c, q) {
  if (!c.resourceTypes.includes(q.type)) return false;
  if (c.requestMethods && !c.requestMethods.includes(q.method)) return false;
  if (c.requestDomains && !domainMatch(q.host, c.requestDomains)) return false;
  if (c.excludedRequestDomains && domainMatch(q.host, c.excludedRequestDomains)) return false;
  if (c.initiatorDomains && !(q.initiator && domainMatch(q.initiator, c.initiatorDomains))) return false;
  if (c.excludedInitiatorDomains && q.initiator && domainMatch(q.initiator, c.excludedInitiatorDomains)) return false;
  if (c.urlFilter && !urlFilterRe(c.urlFilter).test(q.url)) return false;
  if (c.regexFilter && !new RegExp(c.regexFilter).test(q.url)) return false;
  return true;
}
function simulate(rules, q) {
  const hits = rules.filter((r) => ruleMatches(r.condition, q));
  const floor = Math.max(0, ...hits.filter((r) => r.action.type === 'allow').map((r) => r.priority));
  const got = {};
  for (const r of hits.filter((x) => x.action.type === 'modifyHeaders' && x.priority > floor).sort((a, b) => b.priority - a.priority)) {
    for (const h of r.action.requestHeaders) if (!(h.header in got)) got[h.header] = h.value;
  }
  return got;
}
// What the user means: each profile applies if its own filters say so; the first one wins.
function intended(profiles, q) {
  const got = {};
  for (const p of profiles) {
    const f = (kind, type) => p.filters.filter((x) => x.kind === kind && x.type === type).map((x) => x.value);
    const incUrl = p.filters.filter((x) => x.kind === 'include' && x.type !== 'initiator');
    if (p.resourceTypes.length && !p.resourceTypes.includes(q.type)) continue;
    if (incUrl.length && !(domainMatch(q.host, f('include', 'domain')) || f('include', 'pattern').some((v) => urlFilterRe(v).test(q.url)) ||
      f('include', 'regex').some((v) => new RegExp(v).test(q.url)))) continue;
    if (domainMatch(q.host, f('exclude', 'domain'))) continue;
    if (f('exclude', 'pattern').some((v) => urlFilterRe(v).test(q.url)) || f('exclude', 'regex').some((v) => new RegExp(v).test(q.url))) continue;
    if (f('include', 'initiator').length && !(q.initiator && domainMatch(q.initiator, f('include', 'initiator')))) continue;
    if (q.initiator && domainMatch(q.initiator, f('exclude', 'initiator'))) continue;
    for (const h of p.headers) if (!(h.name in got)) got[h.name] = h.value;
  }
  return got;
}

test('random profiles: the compiled rules do what the filters say, unless a warning says otherwise', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const pick = (a) => a[rnd(a.length)];
  const FILTERS = [
    { type: 'pattern', value: '*/health*' }, { type: 'pattern', value: '||api.com^' }, { type: 'regex', value: '\\?debug' },
    { type: 'domain', value: 'api.com' }, { type: 'domain', value: 'cdn.net' }, { type: 'initiator', value: 'app.dev' },
  ];
  const URLS = ['https://api.com/health', 'https://api.com/v1?debug', 'https://x.api.com/a', 'https://cdn.net/health', 'https://cdn.net/lib.js', 'https://other.org/'];
  let checked = 0, warned = 0;
  for (let n = 0; n < 400; n++) {
    const profiles = Array.from({ length: 2 + rnd(3) }, (_, i) => ({
      name: 'P' + i, headers: [hdr('X-Shared', 'P' + i), hdr('X-P' + i, '1')],
      filters: Array.from({ length: rnd(3) }, () => Object.assign({ kind: rnd(2) ? 'include' : 'exclude' }, pick(FILTERS))),
      resourceTypes: rnd(3) ? [] : ['xmlhttprequest'],
    }));
    const st = state(profiles);
    const out = HD.compile(st);
    if (out.problems.length) { warned++; continue; }
    const rules = out.dynamic.concat(out.session);
    for (const url of URLS) {
      for (const type of ['main_frame', 'xmlhttprequest']) {
        for (const initiator of [null, 'app.dev']) {
          const q = { url, type, method: 'get', host: new URL(url).hostname, initiator };
          assert.deepStrictEqual(simulate(rules, q), intended(st.profiles, q), JSON.stringify({ q, profiles }));
          checked++;
        }
      }
    }
  }
  // About half the random states put "Never on" URL filters in two profiles, which DNR cannot express.
  assert.ok(checked > 4000 && warned < 250, `checked ${checked}, warned ${warned}`);
});

test('lower profile with redirects keeps its headers (copied) and gets a redirect warning; two exclusion profiles warn', () => {
  let out = HD.compile(state([
    { name: 'A', headers: [hdr('X-A', '1')], filters: [{ kind: 'exclude', type: 'regex', value: 'health' }] },
    { name: 'B', headers: [hdr('X-B', '1')], redirects: [{ from: 'a.js', to: 'b.js' }] },
  ]));
  assert.strictEqual(out.dynamic.filter((r) => r.action.requestHeaders && r.action.requestHeaders[0].header === 'X-B').length, 2);
  assert.strictEqual(out.problems.length, 1);
  assert.match(out.problems[0].message, /"B" keeps its headers there, but its redirects stay off/);
  out = HD.compile(state([
    { name: 'A', headers: [hdr('X-A', '1')], filters: [{ kind: 'exclude', type: 'regex', value: 'health' }] },
    { name: 'B', headers: [hdr('X-B', '1')], filters: [{ kind: 'exclude', type: 'pattern', value: '*/x' }] },
  ]));
  assert.match(out.problems[0].message, /"B" also has "Never on" URL filters.*Domain exclusion in one of the two/);
});
