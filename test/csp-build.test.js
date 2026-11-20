'use strict';
const test = require('node:test');
const assert = require('node:assert');
// Load the extension's libraries the way the site page does, then the builder.
const HD = require('../extension/lib/model.js');
require('../extension/lib/transfer.js');
require('../extension/lib/paste.js');
const CB = require('../site/js/csp-build.js');

const NOW = Date.parse('2026-11-20T12:00:00Z');
const texts = (ws, level) => ws.filter((w) => !level || w.level === level).map((w) => w.text);
const warnFor = (policy, mode) => CB.warnings(CB.parsePolicy(policy).directives, { mode: mode || 'report' });
const roundTrip = (policy) => CB.serialize(CB.fromBuilder(CB.toBuilder(CB.parsePolicy(policy).directives)));

// ---------------------------------------------------------------- parsing

test('bare value: directives in order, keywords lower-cased, hosts kept as typed', () => {
  const r = CB.parsePolicy("default-src 'SELF';  script-src 'self' https://CDN.example.com 'Unsafe-Inline' ; img-src * DATA: ;");
  assert.strictEqual(r.from, 'value');
  assert.strictEqual(r.mode, null);
  assert.deepStrictEqual(r.directives, [
    { name: 'default-src', tokens: ["'self'"] },
    { name: 'script-src', tokens: ["'self'", 'https://CDN.example.com', "'unsafe-inline'"] },
    { name: 'img-src', tokens: ['*', 'data:'] },
  ]);
  assert.deepStrictEqual(r.notes, []);
});

test('header line, Report-Only header line, and no space after the colon', () => {
  const a = CB.parsePolicy("Content-Security-Policy: default-src 'none'");
  assert.deepStrictEqual([a.from, a.mode, CB.serialize(a.directives)], ['header', 'enforce', "default-src 'none'"]);
  const b = CB.parsePolicy("content-security-policy-report-only:script-src 'self'");
  assert.deepStrictEqual([b.from, b.mode, CB.serialize(b.directives)], ['header', 'report', "script-src 'self'"]);
});

test('a block of response headers: the CSP lines are picked out, the first one loaded', () => {
  const r = CB.parsePolicy(['HTTP/2 200', 'content-type: text/html', "content-security-policy: default-src 'self'",
    "content-security-policy: script-src 'none'", 'x-frame-options: DENY'].join('\n'));
  assert.strictEqual(CB.serialize(r.directives), "default-src 'self'");
  assert.match(r.notes[0], /Found 2 policy headers; loaded the first/);
});

test('<meta> tag with entities, nginx add_header and Apache Header set', () => {
  const m = CB.parsePolicy('<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; img-src &apos;self&apos; data:">');
  assert.deepStrictEqual([m.from, m.mode, CB.serialize(m.directives)], ['meta', 'enforce', "default-src 'self'; img-src 'self' data:"]);
  const n = CB.parsePolicy(`add_header Content-Security-Policy-Report-Only "default-src 'self'; report-uri /csp" always;`);
  assert.deepStrictEqual([n.from, n.mode, CB.serialize(n.directives)], ['nginx', 'report', "default-src 'self'; report-uri /csp"]);
  const a = CB.parsePolicy(`Header always set Content-Security-Policy "frame-ancestors 'none'"`);
  assert.deepStrictEqual([a.from, a.mode, CB.serialize(a.directives)], ['apache', 'enforce', "frame-ancestors 'none'"]);
});

test('a quoted value is unwrapped, a lone quoted keyword is not', () => {
  assert.strictEqual(CB.serialize(CB.parsePolicy(`"default-src 'self'; object-src 'none'"`).directives), "default-src 'self'; object-src 'none'");
  assert.deepStrictEqual(CB.parsePolicy("'self'").directives, []);
});

test('several policies, repeated directives and junk names are reported', () => {
  const r = CB.parsePolicy("script-src 'self'; script-src *; img-src 'self', default-src 'none'");
  assert.strictEqual(CB.serialize(r.directives), "script-src 'self'; img-src 'self'");
  assert.strictEqual(r.notes.length, 2);
  assert.match(r.notes.join('\n'), /2 policies separated by commas/);
  assert.match(r.notes.join('\n'), /script-src appears more than once\. Browsers use the first/);
  assert.deepStrictEqual(CB.parsePolicy('').directives, []);
});

test('nonce and hash prefixes are normalised, their values keep case', () => {
  const r = CB.parsePolicy("script-src 'NONCE-AbC123=' 'SHA256-XyZ+/='");
  assert.deepStrictEqual(r.directives[0].tokens, ["'nonce-AbC123='", "'sha256-XyZ+/='"]);
});

// ---------------------------------------------------------------- builder round trip

test('every preset round-trips through the builder unchanged', () => {
  for (const p of CB.PRESETS) assert.strictEqual(roundTrip(p.policy), p.policy, p.key);
});

test('parse -> builder -> policy keeps every source, puts directives in builder order, keeps unknown ones', () => {
  const pasted = "report-uri https://r.example/csp; img-src data: 'self'; script-src 'self' 'nonce-r4nd0m' 'sha256-abc=' https://cdn.example.com 'unsafe-inline'; script-src-attr 'none'; upgrade-insecure-requests; trusted-types default";
  const b = CB.toBuilder(CB.parsePolicy(pasted).directives);
  assert.deepStrictEqual(b.rows['script-src'], { on: true, chips: ['self', 'unsafe-inline'], other: "'nonce-r4nd0m' 'sha256-abc=' https://cdn.example.com" });
  assert.deepStrictEqual(b.rows['img-src'].chips, ['data', 'self']);
  assert.strictEqual(b.rows['upgrade-insecure-requests'].on, true);
  assert.strictEqual(b.rows['report-uri'].other, 'https://r.example/csp');
  assert.strictEqual(b.rows['style-src'].on, false);
  assert.strictEqual(b.extra, "script-src-attr 'none'; trusted-types default");
  const out = CB.serialize(CB.fromBuilder(b));
  assert.strictEqual(out, "script-src 'self' 'unsafe-inline' 'nonce-r4nd0m' 'sha256-abc=' https://cdn.example.com; img-src 'self' data:; upgrade-insecure-requests; report-uri https://r.example/csp; script-src-attr 'none'; trusted-types default");
  // Same directives and the same source sets as pasted.
  const asSets = (p) => Object.fromEntries(CB.parsePolicy(p).directives.map((d) => [d.name, [...d.tokens].sort()]));
  assert.deepStrictEqual(asSets(out), asSets(pasted));
  // And stable from then on.
  assert.strictEqual(roundTrip(out), out);
});

test('builder edits: free text split on spaces and commas, ";" dropped, duplicates of chips removed, off rows left out', () => {
  const b = CB.toBuilder([]);
  b.rows['connect-src'] = { on: true, chips: ['self'], other: "https://api.example.com, wss://ws.example.com 'SELF'; img-src *" };
  b.rows['font-src'] = { on: false, chips: ['self'], other: 'https://fonts.example' };
  b.rows['object-src'] = { on: true, chips: [], other: '' };
  b.extra = "connect-src 'none'; sandbox allow-scripts";
  assert.strictEqual(CB.serialize(CB.fromBuilder(b)),
    "connect-src 'self' https://api.example.com wss://ws.example.com img-src *; object-src; sandbox allow-scripts");
});

test('the nonce chip stands for the placeholder; a real nonce stays in the text field', () => {
  const b = CB.toBuilder(CB.parsePolicy(`script-src ${CB.NONCE_PLACEHOLDER} 'nonce-abc123'`).directives);
  assert.deepStrictEqual(b.rows['script-src'].chips, ['nonce']);
  assert.strictEqual(b.rows['script-src'].other, "'nonce-abc123'");
});

// ---------------------------------------------------------------- warnings

test('strict starter: no weak spots, one note about frame-ancestors in <meta>', () => {
  const ws = warnFor(CB.PRESETS.find((p) => p.key === 'strict').policy);
  assert.deepStrictEqual(texts(ws, 'warn'), []);
  assert.deepStrictEqual(texts(ws, 'info'), ['frame-ancestors only works in a response header. Browsers ignore it in a <meta> tag.']);
});

test("'unsafe-inline' in script-src is weak without a nonce, hash or 'strict-dynamic'", () => {
  assert.ok(texts(warnFor("default-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'"), 'warn')
    .some((t) => /script-src has 'unsafe-inline' without a nonce or hash/.test(t)));
  for (const extra of ["'sha256-abc='", "'nonce-abc'", "'strict-dynamic' 'nonce-abc'", CB.NONCE_PLACEHOLDER]) {
    const ws = warnFor(`script-src 'unsafe-inline' ${extra}; object-src 'none'; base-uri 'none'`);
    assert.ok(!texts(ws).some((t) => /'unsafe-inline' without/.test(t)), extra);
  }
  // Falls back to default-src when there is no script-src.
  assert.ok(texts(warnFor("default-src 'self' 'unsafe-inline'")).some((t) => /^default-src has 'unsafe-inline'/.test(t)));
});

test('unsafe-eval, broad script sources, and strict-dynamic without a nonce', () => {
  const ws = texts(warnFor("script-src 'self' 'unsafe-eval' https: *; object-src 'none'; base-uri 'self'"), 'warn');
  assert.ok(ws.some((t) => /'unsafe-eval'/.test(t)));
  assert.ok(ws.some((t) => /allows https: \*/.test(t)));
  // With strict-dynamic, https: is a fallback that supporting browsers ignore.
  assert.ok(!texts(warnFor(`script-src ${CB.NONCE_PLACEHOLDER} 'strict-dynamic' https:; object-src 'none'; base-uri 'none'`)).some((t) => /allows https:/.test(t)));
  assert.ok(texts(warnFor("script-src 'self' 'strict-dynamic'; object-src 'none'; base-uri 'none'"), 'warn').some((t) => /'strict-dynamic' but no nonce or hash/.test(t)));
});

test('missing object-src and base-uri (base-uri never falls back), and the framing-only case', () => {
  const ws = texts(warnFor("script-src 'self'"), 'warn');
  assert.ok(ws.some((t) => /No object-src \(and no default-src\)/.test(t)));
  assert.ok(ws.some((t) => /No base-uri, and it does not fall back to default-src/.test(t)));
  // object-src falls back to default-src 'none': nothing to add.
  assert.ok(!texts(warnFor("default-src 'none'; base-uri 'none'")).some((t) => /object-src/.test(t)));
  assert.ok(texts(warnFor("default-src 'self'; base-uri 'self'")).some((t) => /No object-src, so <object> and <embed> fall back to default-src/.test(t)));
  // A framing-only policy gets one warning about scripts, not a pile about object-src and base-uri.
  const f = warnFor("frame-ancestors 'self'");
  assert.deepStrictEqual(texts(f, 'warn').length, 1);
  assert.match(texts(f, 'warn')[0], /No script-src or default-src/);
});

test("common mistakes: unquoted keywords, 'none' with others, empty lists, unknown and removed directives", () => {
  const ws = texts(warnFor("default-src self; img-src 'none' data:; font-src; script-scr 'self'; plugin-types application/pdf; style-src 'unsafe-inlined' \"self\""), 'warn');
  assert.ok(ws.some((t) => /default-src: self without single quotes is read as a host/.test(t)));
  assert.ok(ws.some((t) => /img-src: 'none' is ignored when other sources/.test(t)));
  assert.ok(ws.some((t) => /font-src has no sources/.test(t)));
  assert.ok(ws.some((t) => /script-scr is not a CSP directive/.test(t)));
  assert.ok(ws.some((t) => /plugin-types was removed/.test(t)));
  assert.ok(ws.some((t) => /'unsafe-inlined' is not a CSP keyword/.test(t)));
  assert.ok(ws.some((t) => /"self" uses double quotes/.test(t)));
  // Known CSP3 directives and keywords are not flagged.
  assert.deepStrictEqual(texts(warnFor("default-src 'none'; script-src-elem 'self' 'report-sample' 'wasm-unsafe-eval'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'"), 'warn'), []);
});

test('reporting: report-uri deprecated, report-to needs Reporting-Endpoints, one group only', () => {
  const both = texts(warnFor("default-src 'self'; report-uri https://r.example/csp; report-to csp"));
  assert.ok(both.some((t) => /Browsers that support report-to ignore report-uri when both are set/.test(t)));
  assert.ok(both.some((t) => /report-to csp needs a Reporting-Endpoints header/.test(t)));
  assert.ok(texts(warnFor("default-src 'self'; report-uri https://r.example/csp")).some((t) => /deprecated in favour of report-to, which needs a Reporting-Endpoints header/.test(t)));
  assert.ok(texts(warnFor("default-src 'self'; report-to a b"), 'warn').some((t) => /exactly one group name/.test(t)));
});

test('Report-Only mode notes directives that only work when enforced', () => {
  const p = "default-src 'self'; upgrade-insecure-requests; sandbox allow-scripts";
  assert.strictEqual(texts(warnFor(p, 'report')).filter((t) => /ignored in a Report-Only policy/.test(t)).length, 2);
  assert.strictEqual(texts(warnFor(p, 'enforce')).filter((t) => /Report-Only/.test(t)).length, 0);
  assert.deepStrictEqual(texts(CB.warnings([], {})), ['The policy is empty. Pick a starter or tick some directives.']);
});

// ---------------------------------------------------------------- snippets

test('snippets: header line, nginx, Apache, and <meta> without header-only directives', () => {
  const d = CB.parsePolicy("default-src 'self'; frame-ancestors 'none'; report-uri https://r.example/?a=1&b=2").directives;
  assert.strictEqual(CB.snippet(d, 'value', 'report').text, "default-src 'self'; frame-ancestors 'none'; report-uri https://r.example/?a=1&b=2");
  assert.strictEqual(CB.snippet(d, 'header', 'report').text, "Content-Security-Policy-Report-Only: default-src 'self'; frame-ancestors 'none'; report-uri https://r.example/?a=1&b=2");
  assert.strictEqual(CB.snippet(d, 'nginx', 'enforce').text, `add_header Content-Security-Policy "default-src 'self'; frame-ancestors 'none'; report-uri https://r.example/?a=1&b=2" always;`);
  assert.strictEqual(CB.snippet(d, 'apache', 'enforce').text, `Header always set Content-Security-Policy "default-src 'self'; frame-ancestors 'none'; report-uri https://r.example/?a=1&b=2"`);
  const m = CB.snippet(d, 'meta', 'report');
  assert.strictEqual(m.text, `<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`);
  assert.match(m.note, /Report-Only cannot be set with a <meta> tag/);
  assert.match(m.note, /Left out frame-ancestors, report-uri/);
  // The snippets parse back to the same policy.
  for (const f of ['header', 'nginx', 'apache']) assert.strictEqual(CB.serialize(CB.parsePolicy(CB.snippet(d, f, 'enforce').text).directives), CB.serialize(d), f);
  const amp = CB.snippet(CB.parsePolicy('img-src https://x.example/?a=1&b=2').directives, 'meta', 'enforce').text;
  assert.strictEqual(amp, '<meta http-equiv="Content-Security-Policy" content="img-src https://x.example/?a=1&amp;b=2">');
  assert.strictEqual(CB.serialize(CB.parsePolicy(amp).directives), 'img-src https://x.example/?a=1&b=2');
});

// ---------------------------------------------------------------- test profile

test('test rows: Report-Only by default, optional remove of the site CSP, enforce sets the real header', () => {
  const v = "default-src 'self'";
  assert.deepStrictEqual(CB.testRows(v, {}), [{ name: 'Content-Security-Policy-Report-Only', value: v, op: 'set' }]);
  assert.deepStrictEqual(CB.testRows(v, { removeExisting: true }), [
    { name: 'Content-Security-Policy', value: '', op: 'remove' },
    { name: 'Content-Security-Policy-Report-Only', value: v, op: 'set' }]);
  // In enforce mode the set row already replaces the site's header, so no remove row.
  assert.deepStrictEqual(CB.testRows(v, { mode: 'enforce', removeExisting: true }), [{ name: 'Content-Security-Policy', value: v, op: 'set' }]);
  assert.deepStrictEqual(CB.testRows('  ', {}), []);
  // report-to with an https endpoint adds Reporting-Endpoints; anything else does not.
  const r = "default-src 'self'; report-to csp-endpoint";
  assert.deepStrictEqual(CB.testRows(r, { endpoint: 'https://r.example/csp' })[1], { name: 'Reporting-Endpoints', value: 'csp-endpoint="https://r.example/csp"', op: 'set' });
  assert.strictEqual(CB.testRows(r, { endpoint: 'http://r.example/csp' }).length, 1);
  assert.strictEqual(CB.testRows(v, { endpoint: 'https://r.example/csp' }).length, 1);
});

test('share link and JSON round trip through parseImport, and the extension compiles one rule for the host', () => {
  const value = CB.serialize(CB.parsePolicy(CB.PRESETS.find((p) => p.key === 'cdn').policy).directives);
  const p = CB.buildProfile(value, { host: 'https://www.example.com/shop', removeExisting: true });
  const expected = [
    ['response', 'Content-Security-Policy', '', 'remove'],
    ['response', 'Content-Security-Policy-Report-Only', value, 'set'],
  ];
  const shape = (prof) => prof.headers.map((h) => [h.target, h.name, h.value, h.op]);
  assert.deepStrictEqual(shape(p), expected);

  const link = HD.shareLink(p);
  assert.ok(link.startsWith('https://janwan2003.github.io/request-headers/share/#p='));
  const viaLink = HD.parseImport(link);
  assert.strictEqual(viaLink.source, 'HeaderDial');
  assert.strictEqual(viaLink.profiles.length, 1);
  const q = viaLink.profiles[0];
  assert.strictEqual(q.name, 'CSP Report-Only test (www.example.com)');
  assert.deepStrictEqual(shape(q), expected);
  assert.ok(q.headers.every((h) => h.enabled && !HD.headerProblem(h)));
  assert.deepStrictEqual(q.filters.map((f) => [f.kind, f.type, f.value, HD.filterProblem(f)]), [['include', 'domain', 'www.example.com', '']]);
  assert.deepStrictEqual(shape(HD.parseImport(HD.exportJSON([p])).profiles[0]), expected);

  const rules = HD.compile({ profiles: [q] }, { now: NOW }).dynamic;
  assert.strictEqual(rules.length, 1);
  assert.deepStrictEqual(rules[0].condition.requestDomains, ['www.example.com']);
  assert.deepStrictEqual(rules[0].action.responseHeaders, [
    { header: 'Content-Security-Policy', operation: 'remove' },
    { header: 'Content-Security-Policy-Report-Only', operation: 'set', value }]);

  // Enforce mode, no host: one set row, no filter.
  const e = HD.parseImport(HD.shareLink(CB.buildProfile(value, { mode: 'enforce' }))).profiles[0];
  assert.strictEqual(e.name, 'CSP enforce test');
  assert.deepStrictEqual(shape(e), [['response', 'Content-Security-Policy', value, 'set']]);
  assert.deepStrictEqual(e.filters, []);
});

test('cleanHost accepts what the Domain filter accepts', () => {
  assert.strictEqual(CB.cleanHost(' WWW.Example.com. '), 'www.example.com');
  assert.strictEqual(CB.cleanHost('https://a.example:8443/x?y'), 'a.example');
  assert.strictEqual(CB.cleanHost('not a host'), '');
  assert.strictEqual(CB.cleanHost(''), '');
});
