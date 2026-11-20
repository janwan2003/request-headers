'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const HD = require('../extension/lib/model.js');
require('../extension/lib/transfer.js');
const CK = require('../site/js/cookie-explain.js');

const ids = (r) => r.causes.map((c) => c.id);

test('sites: ports and subdomains do not count, public suffixes and IPs do', () => {
  assert.strictEqual(CK.siteOf('api.example.com'), 'example.com');
  assert.strictEqual(CK.siteOf('a.b.example.co.uk'), 'example.co.uk');
  assert.strictEqual(CK.siteOf('shop.vercel.app'), 'shop.vercel.app');
  assert.strictEqual(CK.siteOf('127.0.0.1'), '127.0.0.1');
  assert.strictEqual(CK.siteOf('localhost'), 'localhost');
  const ctx = (p, u) => CK.context(p, u);
  assert.strictEqual(ctx('http://localhost:5173', 'http://localhost:8080/x').crossSite, false);
  assert.strictEqual(ctx('https://app.example.com', 'https://api.example.com/').crossSite, false);
  assert.strictEqual(ctx('https://app.example.com', 'https://api.example.com/').crossOrigin, true);
  assert.strictEqual(ctx('http://localhost:3000', 'http://127.0.0.1:8000').crossSite, true);
  assert.strictEqual(ctx('https://shop.vercel.app', 'https://shop-api.vercel.app').crossSite, true);
  assert.strictEqual(ctx('http://example.com', 'https://example.com').schemeCross, true);
  assert.strictEqual(ctx('http://localhost:3000', 'http://localhost:8000').schemeCross, false);
  assert.strictEqual(ctx('app.example.com', 'api.example.com').secure, true, 'no scheme means https');
  assert.strictEqual(ctx('', 'http://127.0.0.1:8000/').secure, true, 'http on loopback counts as secure');
  assert.strictEqual(ctx('', 'http://dev.example.com/').secure, false);
});

test('Set-Cookie parsing keeps the attributes', () => {
  const sc = CK.parseSetCookie('Set-Cookie: sid=a=b; path=/api; Max-Age=60; secure; HTTPONLY; SameSite=none; Partitioned; Foo=1');
  assert.strictEqual(sc.name, 'sid');
  assert.strictEqual(sc.value, 'a=b');
  assert.deepStrictEqual(sc.attrs, { path: '/api', maxAge: '60', secure: true, httpOnly: true, sameSite: 'none', partitioned: true });
  assert.deepStrictEqual(sc.unknown, ['Foo']);
});

test('checks on a Set-Cookie line alone', () => {
  const chk = (l, p, u) => CK.checkSetCookie(CK.parseSetCookie(l), CK.context(p, u), Date.parse('2026-11-20T00:00:00Z')).map((x) => x.id + ':' + x.level);
  assert.deepStrictEqual(chk('a=1; SameSite=None'), ['samesite-none-insecure:blocked']);
  assert.deepStrictEqual(chk('a=1; Partitioned; SameSite=None; Secure'), []);
  assert.ok(chk('a=1; Partitioned').includes('partitioned-insecure:blocked'));
  assert.deepStrictEqual(chk('__Secure-a=1'), ['invalid-prefix:blocked']);
  assert.deepStrictEqual(chk('__Host-a=1; Secure; Path=/'), []);
  assert.deepStrictEqual(chk('__Host-a=1; Secure; Path=/; Domain=example.com'), ['invalid-prefix:blocked']);
  assert.deepStrictEqual(chk('a=' + 'x'.repeat(4100)), ['too-large:blocked']);
  assert.deepStrictEqual(chk('a b=1'), ['odd-name:warn'], 'both browsers store it (measured)');
  assert.deepStrictEqual(chk('a\tb=1'), ['invalid-syntax:blocked']);
  assert.deepStrictEqual(chk('a=1\x01'), ['invalid-syntax:blocked']);
  assert.deepStrictEqual(chk('a=1; SameSite=no_restriction'), ['samesite-invalid:warn']);
  assert.deepStrictEqual(chk('a=1; Max-Age=0'), ['deleted:info']);
  assert.deepStrictEqual(chk('a=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT'), ['deleted:info']);
  assert.deepStrictEqual(chk('a=1; Max-Age=63072000'), ['max-age-capped:info']);
  assert.deepStrictEqual(chk('a=1; HttpOnly'), ['httponly-script:info']);
  // With the cookie URL.
  assert.deepStrictEqual(chk('a=1; Secure; Path=/', '', 'http://dev.example.com/'), ['secure-insecure:blocked']);
  assert.deepStrictEqual(chk('a=1; Secure; Path=/', '', 'http://localhost:8080/'), []);
  assert.deepStrictEqual(chk('a=1; Path=/; Domain=other.com', '', 'https://api.example.com/'), ['invalid-domain:blocked']);
  assert.deepStrictEqual(chk('a=1; Path=/; Domain=.example.com', '', 'https://api.example.com/'), []);
  assert.deepStrictEqual(chk('a=1; Path=/; Domain=vercel.app', '', 'https://shop.vercel.app/'), ['invalid-domain:blocked']);
  assert.deepStrictEqual(chk('a=1', '', 'https://api.example.com/api/auth/login'), ['path-mismatch:warn']);
  assert.deepStrictEqual(chk('a=1', '', 'https://api.example.com/login'), []);
  // With the page too.
  assert.deepStrictEqual(chk('a=1; Path=/', 'http://localhost:5173/', 'http://localhost:8080/login'), ['credentials:warn'], 'same site, other port: only credentials');
  assert.deepStrictEqual(chk('a=1; Path=/', 'http://localhost:3000/', 'http://127.0.0.1:8000/login'), ['samesite-default-lax:blocked', 'credentials:warn']);
  assert.deepStrictEqual(chk('a=1; Path=/; SameSite=Lax', 'https://a.vercel.app/', 'https://b.vercel.app/'), ['samesite-lax:blocked', 'credentials:warn']);
  assert.deepStrictEqual(chk('a=1; Path=/; SameSite=Strict', 'https://a.vercel.app/', 'https://b.vercel.app/'), ['samesite-strict:blocked', 'credentials:warn']);
  assert.deepStrictEqual(chk('a=1; Path=/; SameSite=None; Secure', 'https://a.vercel.app/', 'https://b.vercel.app/'),
    ['third-party-blocked:warn', 'partitioned-info:info', 'credentials:warn', 'host-only:info']);
  assert.deepStrictEqual(chk('a=1; Path=/', 'http://example.com/', 'https://example.com/'), ['schemeful:blocked', 'credentials:warn']);
  assert.deepStrictEqual(chk('a=1; Path=/', 'https://app.example.com/', 'https://api.example.com/'), ['credentials:warn', 'host-only:info']);
});

test('fixSetCookie changes only what the causes need', () => {
  const fix = (l, o) => CK.fixSetCookie(CK.parseSetCookie(l), o);
  assert.strictEqual(fix('sid=1; Path=/; HttpOnly', { crossSite: true }).line, 'sid=1; Path=/; Secure; HttpOnly; SameSite=None');
  assert.strictEqual(fix('sid=1; Path=/; HttpOnly', { crossSite: true, partitioned: true }).line, 'sid=1; Path=/; Secure; HttpOnly; SameSite=None; Partitioned');
  assert.strictEqual(fix('sid=1; Path=/; SameSite=None').line, 'sid=1; Path=/; Secure; SameSite=None');
  assert.strictEqual(fix('sid=1; Path=/; SameSite=bogus').line, 'sid=1; Path=/; SameSite=Lax');
  assert.strictEqual(fix('__Host-s=1; Domain=example.com; Path=/app').line, '__Host-s=1; Path=/; Secure');
  assert.strictEqual(fix('s=1; Domain=other.com; Path=/', { ctx: CK.context('', 'https://api.example.com/') }).line, 's=1; Path=/');
  assert.strictEqual(fix('s=1; Domain=example.com; Path=/', { ctx: CK.context('', 'https://api.example.com/') }).line, 's=1; Domain=example.com; Path=/');
  assert.strictEqual(fix('s=1', { ctx: CK.context('', 'https://api.example.com/auth/login') }).line, 's=1; Path=/');
  assert.strictEqual(fix('s=1; Max-Age=3600; Path=/').changes.length, 0);
});

test('messages: Firefox names the cookie, Chrome tooltips map to causes', () => {
  const FF = [
    ['Cookie “sid” rejected because it has the “SameSite=None” attribute but is missing the “secure” attribute.', 'samesite-none-insecure'],
    ['Cookie “sid” has been rejected because it is in a cross-site context and its “SameSite” is “Lax” or “Strict”.', 'samesite-cross-site'],
    ['Cookie “sid” has been rejected for invalid domain.', 'invalid-domain'],
    ['Cookie “__Host-sid” has been rejected for invalid prefix.', 'invalid-prefix'],
    ['Cookie “sid” has been rejected because a non-HTTPS cookie can’t be set as “secure”.', 'secure-insecure'],
    ['Cookie “sid” is invalid because its size is too big. Max size is 4096 B.', 'too-large'],
    ['Cookie “sid” has been rejected because there is an existing “secure” cookie.', 'overwrite-secure'],
  ];
  for (const [t, want] of FF) {
    const m = CK.parseMessage(t);
    assert.strictEqual(m.id, want, t);
    assert.strictEqual(m.browser, 'firefox');
    assert.ok(/sid/.test(m.name), t);
  }
  const CH = [
    ['This attempt to set a cookie via a Set-Cookie header was blocked because it had the "SameSite=None" attribute but did not have the "Secure" attribute, which is required in order to use "SameSite=None".', 'samesite-none-insecure', 'set'],
    ['This Set-Cookie header didn\'t specify a "SameSite" attribute and was defaulted to "SameSite=Lax," and was blocked because it came from a cross-site response which was not the response to a top-level navigation. The Set-Cookie had to have been set with "SameSite=None" to enable cross-site usage.', 'samesite-default-lax', 'set'],
    ['This cookie was blocked because it had the "SameSite=Lax" attribute and the request was made from a different site and was not initiated by a top-level navigation.', 'samesite-lax', 'send'],
    ['This cookie was blocked because it had the "SameSite=Strict" attribute and the request was made from a different site. This includes top-level navigation requests initiated by other sites.', 'samesite-strict', 'send'],
    ['This attempt to set a cookie via a Set-Cookie header was blocked because its Domain attribute was invalid with regards to the current host url.', 'invalid-domain', 'set'],
    ['This cookie was blocked because its path was not an exact match for or a superdirectory of the request url\'s path.', 'path-mismatch', 'send'],
  ];
  for (const [t, want, side] of CH) {
    const m = CK.parseMessage(t);
    assert.strictEqual(m.id, want, t);
    assert.strictEqual(m.browser, 'chrome', t);
    assert.strictEqual(m.side, side, t);
    assert.strictEqual(m.name, '', 'Chrome tooltips carry no cookie name');
  }
  const tp = CK.parseMessage('Cookie “s12new=1; SameSite=None; Secure” has been rejected as third-party.');
  assert.deepStrictEqual([tp.id, tp.name], ['third-party-blocked', 's12new'], 'Firefox puts the whole line there; keep the name');
  assert.strictEqual(CK.parseMessage('TypeError: Failed to fetch'), null);
  assert.strictEqual(CK.parseMessage('some cookie thing nobody knows').id, 'unknown');
});

test('explain: a Chrome message and the pasted line make one cause with the line\'s name', () => {
  const r = CK.explain('Set-Cookie: sid=1; Path=/; HttpOnly; SameSite=None\nThis attempt to set a cookie via a Set-Cookie header was blocked because it had the "SameSite=None" attribute but did not have the "Secure" attribute, which is required in order to use "SameSite=None".',
    { page: 'http://localhost:5173/', url: 'https://api.example.com/login' });
  assert.deepStrictEqual(ids(r), ['samesite-none-insecure', 'credentials', 'httponly-script']);
  assert.strictEqual(r.causes[0].name, 'sid');
  assert.strictEqual(r.crossSite, true);
  assert.strictEqual(r.browser, 'chrome');
  // Without URLs, the cause alone says the cookie must work cross-site.
  assert.strictEqual(CK.explain('Cookie “t” has been rejected because it is in a cross-site context and its “SameSite” is “Lax” or “Strict”.').crossSite, true);
  // A bare name=value line with attributes counts as a Set-Cookie line.
  assert.strictEqual(CK.explain('sid=1; Path=/; Secure').setCookies.length, 1);
});

test('snippets and the HeaderDial profile', () => {
  const f = CK.fixSetCookie(CK.parseSetCookie('sid=abc; Max-Age=3600; HttpOnly'), { crossSite: true, partitioned: true });
  assert.strictEqual(CK.snippet('sid', 'abc', f.attrs, 'header'), 'Set-Cookie: sid=abc; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=None; Partitioned');
  const ex = CK.snippet('sid', 'abc', f.attrs, 'express');
  assert.match(ex, /res\.cookie\('sid', 'abc', \{\n  httpOnly: true,\n  secure: true,\n  sameSite: 'none',\n  partitioned: true,\n  path: '\/',\n  maxAge: 3600000,\n\}\);/);
  assert.match(CK.snippet('sid', 'abc', f.attrs, 'php'), /'expires' => time\(\) \+ 3600,[\s\S]*'samesite' => 'None'/);
  assert.match(CK.snippet('sid', 'abc', f.attrs, 'django'), /max_age=3600,[\s\S]*samesite="None"/);
  assert.match(CK.snippet('sid', 'abc', f.attrs, 'nginx'), /proxy_cookie_flags sid secure httponly samesite=none;/);
  const p = CK.buildProfile({ name: 'sid', value: 'abc', attrs: 'Path=/; Secure; SameSite=None', host: 'API.example.com', send: true });
  assert.deepStrictEqual(p.cookies.map((c) => [c.target, c.name, c.value, c.attrs]), [['response', 'sid', 'abc', 'Path=/; Secure; SameSite=None'], ['request', 'sid', 'abc', '']]);
  assert.deepStrictEqual(p.filters.map((x) => [x.type, x.value]), [['domain', 'api.example.com']]);
  // The share link round-trips through the importer.
  const back = HD.parseImport(HD.shareLink(p)).profiles[0];
  assert.deepStrictEqual(back.cookies.map((c) => c.target + ':' + HD.cookieInfo(c).value), ['response:sid=abc; Path=/; Secure; SameSite=None', 'request:sid=abc']);
});

// Texts captured in Chrome 159 and Firefox 158 (test/measure-cookie-messages.js).
const FIX = path.join(__dirname, 'fixtures/cookie-messages.json');
test('every captured browser text is recognised', { skip: !fs.existsSync(FIX) }, () => {
  const all = JSON.parse(fs.readFileSync(FIX, 'utf8'));
  const texts = all.filter((x) => x.kind !== 'cdp-reason' && x.text);
  assert.ok(texts.length > 5);
  const unknown = texts.filter((x) => { const m = CK.parseMessage(x.text); return !m || m.id === 'unknown'; });
  assert.deepStrictEqual(unknown.map((x) => x.scenario + ' ' + x.browser + ': ' + x.text), []);
});
