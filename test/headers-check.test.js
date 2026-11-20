'use strict';
const test = require('node:test');
const assert = require('node:assert');
// Load the extension's libraries the way the extension does (paste.js included, so
// parseImport goes through the same request-text check first), then the checker.
const HD = require('../extension/lib/model.js');
require('../extension/lib/transfer.js');
require('../extension/lib/paste.js');
const HC = require('../site/js/headers-check.js');

const NOW = Date.parse('2026-11-20T12:00:00Z');
const run = (text) => { const res = HC.parseResponse(text); return { res, out: HC.check(res, { now: NOW }) }; };
const verdict = (out, key) => out.rows.filter((r) => r.key === key).map((r) => r.verdict);
const rowOf = (out, key) => out.rows.find((r) => r.key === key);
// Wrap headers in a minimal HTML response so page-only rules apply.
const page = (lines) => run(['HTTP/1.1 200 OK', 'Content-Type: text/html; charset=utf-8'].concat(lines).join('\n'));

// ---------------------------------------------------------------- input formats

// Chrome "Raw" view of an HTTP/1.1 response (status line, then Name: value lines).
const CHROME_RAW = `HTTP/1.1 200 OK
Server: nginx/1.18.0 (Ubuntu)
Date: Fri, 20 Nov 2026 10:00:00 GMT
Content-Type: text/html; charset=utf-8
Transfer-Encoding: chunked
Connection: keep-alive
X-Powered-By: Express
Set-Cookie: sid=s%3Aabc; Path=/; HttpOnly
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.example.net
X-Frame-Options: SAMEORIGIN`;

test('Chrome raw view: status line and Name: value lines', () => {
  const res = HC.parseResponse(CHROME_RAW);
  assert.strictEqual(res.source, 'raw');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.length, 9);
  assert.deepStrictEqual(res.headers[0], { name: 'Server', value: 'nginx/1.18.0 (Ubuntu)' });
  // A value with colons (a date) stays whole.
  assert.strictEqual(res.headers[1].value, 'Fri, 20 Nov 2026 10:00:00 GMT');
  assert.strictEqual(res.host, '');
});

// Firefox "Raw" toggle of an HTTP/2 response: "HTTP/2 200 " with a trailing space, lower-case names.
test('Firefox raw view of HTTP/2 (trailing space after the status)', () => {
  const res = HC.parseResponse('HTTP/2 200 \ncontent-type: text/html\nstrict-transport-security: max-age=31536000\nx-content-type-options: nosniff\n');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.headers.map((h) => h.name), ['content-type', 'strict-transport-security', 'x-content-type-options']);
});

// A selection copied from Chrome's non-raw Headers tab: each name and value on its own
// line, with the General section and the request headers around it.
const CHROME_LIST = `General
Request URL
https://www.example.com/account?tab=1
Request Method
GET
Status Code
200 OK
Remote Address
93.184.215.14:443
Referrer Policy
strict-origin-when-cross-origin
Response Headers
Raw
cache-control
private, max-age=0
content-security-policy
default-src 'self'; script-src 'self' 'nonce-r4nd0m' 'strict-dynamic'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
content-type
text/html; charset=utf-8
cross-origin-opener-policy
same-origin
link
<https://www.example.com/style.css>; rel=preload
location-hint
https://www.example.com:8443/x
set-cookie
sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax
strict-transport-security
max-age=63072000; includeSubDomains; preload
x-content-type-options
nosniff
Request Headers
:authority
www.example.com
accept
text/html
referer
https://www.example.com/`;

test('Chrome list view: name and value on separate lines; General section and request headers are not response headers', () => {
  const res = HC.parseResponse(CHROME_LIST);
  assert.strictEqual(res.source, 'list');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.url, 'https://www.example.com/account?tab=1');
  assert.strictEqual(res.host, 'www.example.com');
  assert.strictEqual(res.scheme, 'https');
  assert.deepStrictEqual(res.headers.map((h) => h.name), ['cache-control', 'content-security-policy', 'content-type',
    'cross-origin-opener-policy', 'link', 'location-hint', 'set-cookie', 'strict-transport-security', 'x-content-type-options']);
  // A value that looks like "name: value" (a URL) stays a value in list mode.
  assert.strictEqual(res.headers.find((h) => h.name === 'location-hint').value, 'https://www.example.com:8443/x');
  // "Referrer Policy" in General is the request's policy, not a Referrer-Policy header.
  assert.ok(!res.headers.some((h) => /referr?er/i.test(h.name)));
});

test('General section written as "Label: value" lines', () => {
  const res = HC.parseResponse('Request URL: http://intranet.local/\nStatus Code: 302 Found\nlocation: /login\n');
  assert.strictEqual(res.status, 302);
  assert.strictEqual(res.host, 'intranet.local');
  assert.strictEqual(res.scheme, 'http');
});

// curl -sIL http://example.com: one block per hop; the last is checked, Location gives the final URL.
const CURL_REDIRECTS = `$ curl -sIL http://example.com/
HTTP/1.1 301 Moved Permanently
Server: cloudflare
Location: https://example.com/

HTTP/2 301
location: https://www.example.com/
strict-transport-security: max-age=31536000

HTTP/2 200
content-type: text/html; charset=UTF-8
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
server: cloudflare
`;

test('curl -I -L output: several responses, the last one is checked, the host follows the redirects', () => {
  const res = HC.parseResponse(CURL_REDIRECTS);
  assert.strictEqual(res.responses, 3);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.url, 'https://www.example.com/');
  assert.strictEqual(res.host, 'www.example.com');
  assert.deepStrictEqual(res.headers.map((h) => h.name), ['content-type', 'strict-transport-security', 'x-content-type-options', 'server']);
  assert.ok(res.notes.some((n) => /3 responses/.test(n)));
});

test('curl -sD - -o /dev/null with CRLF line ends and an interim 100 Continue', () => {
  const res = HC.parseResponse('HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 201 Created\r\nContent-Type: application/json\r\nX-Content-Type-Options: nosniff\r\n\r\n');
  assert.strictEqual(res.status, 201);
  assert.deepStrictEqual(res.headers, [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-Content-Type-Options', value: 'nosniff' }]);
});

test('curl -v output: only "< " lines are the response; the URL comes from the request line or Host', () => {
  const res = HC.parseResponse(`*   Trying 93.184.215.14:443...
* Connected to api.example.com (93.184.215.14) port 443
> GET /v1/me HTTP/2
> Host: api.example.com
> user-agent: curl/8.5.0
>
< HTTP/2 200
< content-type: application/json
< access-control-allow-origin: *
< access-control-allow-credentials: true
<
{"ok":true}`);
  assert.strictEqual(res.source, 'curl -v');
  assert.strictEqual(res.host, 'api.example.com');
  assert.deepStrictEqual(res.headers.map((h) => h.name), ['content-type', 'access-control-allow-origin', 'access-control-allow-credentials']);
});

test('Firefox "Copy All" JSON from the Headers panel: the response headers are picked, not the request headers', () => {
  const json = JSON.stringify({
    'Response Headers (1.2 kB)': { headers: [{ name: 'content-type', value: 'text/html' }, { name: 'x-frame-options', value: 'DENY' }] },
    'Request Headers (512 B)': { headers: [{ name: 'accept', value: '*/*' }] },
  });
  const res = HC.parseResponse(json);
  assert.strictEqual(res.source, 'json');
  assert.deepStrictEqual(res.headers.map((h) => h.name), ['content-type', 'x-frame-options']);
  // A plain JSON object of headers also works.
  assert.deepStrictEqual(HC.parseResponse('{"X-Content-Type-Options":"nosniff"}').headers, [{ name: 'X-Content-Type-Options', value: 'nosniff' }]);
});

test('HTTP/2 :status pseudo-header and lines that are not headers', () => {
  const res = HC.parseResponse(':status: 404\ncontent-type: text/html\nthis is not a header\n');
  assert.strictEqual(res.status, 404);
  assert.deepStrictEqual(res.headers.map((h) => h.name), ['content-type']);
  assert.ok(res.notes.some((n) => /Skipped 1 line/.test(n)));
  assert.strictEqual(HC.parseResponse(''), null);
  assert.strictEqual(HC.parseResponse('hello world\nnothing here'), null);
});

// ---------------------------------------------------------------- verdicts

test('Content-Security-Policy rules', () => {
  assert.deepStrictEqual(verdict(page([]).out, 'csp'), ['missing']);
  let r = rowOf(page(["Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'"]).out, 'csp');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /'unsafe-inline' without a nonce or hash/);
  // A nonce or hash makes browsers ignore 'unsafe-inline'.
  assert.deepStrictEqual(verdict(page(["Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'nonce-abc'"]).out, 'csp'), ['good']);
  assert.deepStrictEqual(verdict(page(["Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'sha256-AbC='"]).out, 'csp'), ['good']);
  r = rowOf(page(["Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-eval'"]).out, 'csp');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /unsafe-eval/);
  r = rowOf(page(["Content-Security-Policy: img-src 'self'"]).out, 'csp');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /no script-src or default-src/); assert.match(r.reason, /object-src/);
  r = rowOf(page(["Content-Security-Policy: script-src 'self'"]).out, 'csp');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /no object-src or default-src/);
  r = rowOf(page(["Content-Security-Policy: default-src 'self'; script-src https:"]).out, 'csp');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /any host/);
  // Report-Only alone blocks nothing.
  r = rowOf(page(["Content-Security-Policy-Report-Only: default-src 'self'"]).out, 'csp');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /nothing is blocked/);
  // Two policies: a script must pass both, so the strict one counts.
  assert.deepStrictEqual(verdict(page(["Content-Security-Policy: script-src * 'unsafe-inline'", "Content-Security-Policy: default-src 'self'"]).out, 'csp'), ['good']);
  // Not a page: not applicable.
  assert.deepStrictEqual(verdict(run('HTTP/1.1 200 OK\nContent-Type: application/json').out, 'csp'), ['na']);
});

test('X-Frame-Options vs CSP frame-ancestors', () => {
  assert.deepStrictEqual(verdict(page([]).out, 'framing'), ['missing']);
  assert.deepStrictEqual(verdict(page(['X-Frame-Options: DENY']).out, 'framing'), ['good']);
  assert.deepStrictEqual(verdict(page(['X-Frame-Options: sameorigin']).out, 'framing'), ['good']);
  let r = rowOf(page(['X-Frame-Options: ALLOW-FROM https://a.example']).out, 'framing');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /obsolete/);
  assert.deepStrictEqual(verdict(page(['X-Frame-Options: maybe']).out, 'framing'), ['weak']);
  // Conflicting values: the HTML spec blocks framing.
  assert.deepStrictEqual(verdict(page(['X-Frame-Options: DENY', 'X-Frame-Options: SAMEORIGIN']).out, 'framing'), ['good']);
  // frame-ancestors wins over X-Frame-Options.
  r = rowOf(page(["Content-Security-Policy: frame-ancestors 'self'", 'X-Frame-Options: ALLOW-FROM https://a.example']).out, 'framing');
  assert.strictEqual(r.verdict, 'good'); assert.match(r.reason, /ignore X-Frame-Options/);
  assert.deepStrictEqual(verdict(page(['Content-Security-Policy: frame-ancestors *']).out, 'framing'), ['weak']);
  r = rowOf(page(["Content-Security-Policy-Report-Only: frame-ancestors 'none'"]).out, 'framing');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /Report-Only/);
  assert.deepStrictEqual(verdict(run('HTTP/1.1 200 OK\nContent-Type: image/png').out, 'framing'), ['na']);
});

test('Strict-Transport-Security rules', () => {
  assert.deepStrictEqual(verdict(page([]).out, 'hsts'), ['missing']);
  let r = rowOf(page(['Strict-Transport-Security: max-age=86400']).out, 'hsts');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /max-age is 1 day; use at least 6 months/);
  assert.deepStrictEqual(verdict(page(['Strict-Transport-Security: max-age=0']).out, 'hsts'), ['weak']);
  assert.deepStrictEqual(verdict(page(['Strict-Transport-Security: includeSubDomains']).out, 'hsts'), ['weak']);
  assert.deepStrictEqual(verdict(page(['Strict-Transport-Security: max-age=31536000; max-age=31536000']).out, 'hsts'), ['weak']);
  r = rowOf(page(['Strict-Transport-Security: max-age=15552000']).out, 'hsts');
  assert.strictEqual(r.verdict, 'good'); assert.match(r.reason, /without includeSubDomains/);
  r = rowOf(page(['Strict-Transport-Security: max-age="31536000"; includeSubDomains']).out, 'hsts');
  assert.strictEqual(r.verdict, 'good'); assert.match(r.reason, /subdomains included/);
  r = rowOf(page(['Strict-Transport-Security: max-age=15552000; includeSubDomains; preload']).out, 'hsts');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /preload/);
  assert.deepStrictEqual(verdict(page(['Strict-Transport-Security: max-age=63072000; includeSubDomains; preload']).out, 'hsts'), ['good']);
  // Over plain HTTP the header is ignored.
  assert.deepStrictEqual(verdict(run('Request URL: http://a.example/\nStatus Code: 200\ncontent-type: text/html').out, 'hsts'), ['na']);
});

test('X-Content-Type-Options, Referrer-Policy and Permissions-Policy rules', () => {
  assert.deepStrictEqual(verdict(page([]).out, 'xcto'), ['missing']);
  assert.deepStrictEqual(verdict(page(['X-Content-Type-Options: NoSniff']).out, 'xcto'), ['good']);
  assert.deepStrictEqual(verdict(page(['X-Content-Type-Options: yes']).out, 'xcto'), ['weak']);

  assert.deepStrictEqual(verdict(page([]).out, 'referrer'), ['missing']);
  assert.deepStrictEqual(verdict(page(['Referrer-Policy: strict-origin-when-cross-origin']).out, 'referrer'), ['good']);
  assert.deepStrictEqual(verdict(page(['Referrer-Policy: no-referrer']).out, 'referrer'), ['good']);
  assert.deepStrictEqual(verdict(page(['Referrer-Policy: unsafe-url']).out, 'referrer'), ['weak']);
  assert.deepStrictEqual(verdict(page(['Referrer-Policy: no-referrer-when-downgrade']).out, 'referrer'), ['weak']);
  // The last recognised value wins (a fallback list).
  assert.deepStrictEqual(verdict(page(['Referrer-Policy: unsafe-url, strict-origin-when-cross-origin']).out, 'referrer'), ['good']);
  assert.deepStrictEqual(verdict(page(['Referrer-Policy: no-referrer, made-up']).out, 'referrer'), ['good']);
  assert.deepStrictEqual(verdict(page(['Referrer-Policy: made-up']).out, 'referrer'), ['weak']);

  assert.deepStrictEqual(verdict(page([]).out, 'permissions'), ['missing']);
  assert.deepStrictEqual(verdict(page(['Permissions-Policy: camera=(), microphone=(self "https://a.example"), geolocation=*']).out, 'permissions'), ['good']);
  let r = rowOf(page(["Permissions-Policy: camera 'none'; microphone 'none'"]).out, 'permissions');
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /Feature-Policy syntax/);
  assert.deepStrictEqual(verdict(page(['Permissions-Policy: Camera=()']).out, 'permissions'), ['weak']);
  assert.deepStrictEqual(verdict(page(["Feature-Policy: camera 'none'"]).out, 'permissions'), ['weak']);
});

test('Cross-Origin-Opener / -Embedder / -Resource-Policy rules', () => {
  let { out } = page([]);
  assert.deepStrictEqual([verdict(out, 'coop'), verdict(out, 'coep'), verdict(out, 'corp')], [['missing'], ['na'], ['missing']]);
  ({ out } = page(['Cross-Origin-Opener-Policy: same-origin', 'Cross-Origin-Embedder-Policy: require-corp', 'Cross-Origin-Resource-Policy: same-origin']));
  assert.deepStrictEqual([verdict(out, 'coop'), verdict(out, 'coep'), verdict(out, 'corp')], [['good'], ['good'], ['good']]);
  assert.match(rowOf(out, 'coep').reason, /cross-origin isolated/);
  ({ out } = page(['Cross-Origin-Opener-Policy: same-origin-allow-popups; report-to="x"', 'Cross-Origin-Embedder-Policy: credentialless', 'Cross-Origin-Resource-Policy: cross-origin']));
  assert.deepStrictEqual([verdict(out, 'coop'), verdict(out, 'coep'), verdict(out, 'corp')], [['good'], ['good'], ['good']]);
  ({ out } = page(['Cross-Origin-Opener-Policy: unsafe-none', 'Cross-Origin-Embedder-Policy: bogus', 'Cross-Origin-Resource-Policy: anyone']));
  assert.deepStrictEqual([verdict(out, 'coop'), verdict(out, 'coep'), verdict(out, 'corp')], [['weak'], ['weak'], ['weak']]);
});

test('Set-Cookie rules: Secure, HttpOnly, SameSite, prefixes, deletions', () => {
  const { out } = page([
    'Set-Cookie: good=1; Path=/; Secure; HttpOnly; SameSite=Lax',
    'Set-Cookie: plain=1; Path=/',
    'Set-Cookie: cross=1; SameSite=None; HttpOnly',
    'Set-Cookie: __Host-x=1; Secure; HttpOnly; SameSite=Strict; Path=/; Domain=example.com',
    'Set-Cookie: __Secure-y=1; HttpOnly; SameSite=Lax',
    'Set-Cookie: gone=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
    'Set-Cookie: gone2=x; Max-Age=0',
    'Set-Cookie: odd=1; Secure; HttpOnly; SameSite=Sometimes',
  ]);
  const cookies = out.rows.filter((r) => r.key === 'cookie');
  assert.deepStrictEqual(cookies.map((r) => [r.header, r.verdict]), [
    ['Set-Cookie good', 'good'], ['Set-Cookie plain', 'weak'], ['Set-Cookie cross', 'weak'], ['Set-Cookie __Host-x', 'weak'],
    ['Set-Cookie __Secure-y', 'weak'], ['Set-Cookie gone', 'na'], ['Set-Cookie gone2', 'na'], ['Set-Cookie odd', 'weak']]);
  assert.match(cookies[1].reason, /no Secure/i); assert.match(cookies[1].reason, /HttpOnly/); assert.match(cookies[1].reason, /SameSite/);
  assert.match(cookies[2].reason, /SameSite=None without Secure is rejected/);
  assert.match(cookies[3].reason, /__Host-/);
  assert.match(cookies[4].reason, /__Secure-/);
  assert.match(cookies[7].reason, /not Lax, Strict or None/);
  // The cookie's value is never shown, only its name and attributes.
  assert.ok(cookies.every((r) => !/=1;|=s%3A/.test(r.value)));
  assert.strictEqual(cookies[0].value, 'good=…; Path=/; Secure; HttpOnly; SameSite=Lax');
});

test('CORS rules', () => {
  const cors = (lines) => rowOf(run(['HTTP/2 200', 'content-type: application/json'].concat(lines).join('\n')).out, 'cors');
  assert.strictEqual(cors([]).verdict, 'na');
  let r = cors(['access-control-allow-origin: *', 'access-control-allow-credentials: true']);
  assert.strictEqual(r.verdict, 'weak'); assert.match(r.reason, /invalid/);
  assert.strictEqual(cors(['access-control-allow-origin: *']).verdict, 'good');
  assert.strictEqual(cors(['access-control-allow-origin: null']).verdict, 'weak');
  assert.strictEqual(cors(['access-control-allow-origin: https://a.example, https://b.example']).verdict, 'weak');
  r = cors(['access-control-allow-origin: https://app.example', 'access-control-allow-credentials: true']);
  assert.strictEqual(r.verdict, 'good'); assert.match(r.reason, /Vary: Origin/);
  r = cors(['access-control-allow-origin: https://app.example', 'vary: Accept-Encoding, Origin']);
  assert.doesNotMatch(r.reason, /Vary/);
});

test('Info leaks: Server versions, X-Powered-By; X-XSS-Protection', () => {
  let { out } = run(CHROME_RAW);
  assert.deepStrictEqual(out.rows.filter((r) => r.key === 'leak').map((r) => [r.header, r.verdict]), [['Server', 'weak'], ['X-Powered-By', 'weak']]);
  ({ out } = page(['Server: nginx']));
  assert.deepStrictEqual(out.rows.filter((r) => r.key === 'leak').map((r) => [r.header, r.verdict]), [['Server / X-Powered-By', 'good']]);
  ({ out } = page(['X-AspNet-Version: 4.0.30319']));
  assert.deepStrictEqual(verdict(out, 'leak'), ['weak']);
  assert.deepStrictEqual(verdict(page([]).out, 'xxss'), []);
  assert.deepStrictEqual(verdict(page(['X-XSS-Protection: 0']).out, 'xxss'), ['good']);
  assert.deepStrictEqual(verdict(page(['X-XSS-Protection: 1; mode=block']).out, 'xxss'), ['weak']);
});

test('A full Chrome copy: counts and verdicts together', () => {
  const { res, out } = run(CHROME_LIST);
  const v = Object.fromEntries(out.rows.map((r) => [r.header, r.verdict]));
  assert.strictEqual(v['Content-Security-Policy'], 'good');
  assert.strictEqual(v['X-Frame-Options / frame-ancestors'], 'good');
  assert.strictEqual(v['Strict-Transport-Security'], 'good');
  assert.strictEqual(v['Set-Cookie sid'], 'good');
  assert.strictEqual(v['Referrer-Policy'], 'missing');
  const sum = out.counts.good + out.counts.weak + out.counts.missing + out.counts.na;
  assert.strictEqual(sum, out.rows.length);
  assert.strictEqual(res.host, 'www.example.com');
  // Redirect responses: page-only headers are not applicable.
  const redir = run('HTTP/1.1 301 Moved Permanently\nLocation: https://x.example/').out;
  assert.deepStrictEqual([verdict(redir, 'csp'), verdict(redir, 'framing')], [['na'], ['na']]);
});

// ---------------------------------------------------------------- suggestions and profile

test('Suggestions: ticked where the verdict is weak or missing; the CSP starts from the site\'s own', () => {
  let { res, out } = run(CHROME_RAW);
  let s = HC.suggestions(res, out);
  const on = (list) => list.filter((x) => x.on).map((x) => x.name);
  assert.deepStrictEqual(on(s), ['Content-Security-Policy-Report-Only', 'Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy']);
  const csp = s.find((x) => x.key === 'csp').value;
  assert.strictEqual(csp, "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.example.net; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  assert.strictEqual(s.find((x) => x.key === 'hsts').value, 'max-age=300');
  // No CSP at all: the starter policy; with X-Frame-Options: DENY it keeps framing denied.
  ({ res, out } = page(['X-Frame-Options: DENY']));
  s = HC.suggestions(res, out);
  assert.strictEqual(s.find((x) => x.key === 'csp').value, HC.STARTER_CSP.replace("frame-ancestors 'self'", "frame-ancestors 'none'"));
  assert.ok(!s.find((x) => x.key === 'framing').on);
  // Plain HTTP: no HSTS suggestion.
  ({ res, out } = run('Request URL: http://a.example/\nStatus Code: 200\ncontent-type: text/html'));
  assert.ok(!HC.suggestions(res, out).some((x) => x.key === 'hsts'));
});

test('cleanHost accepts what a Domain filter accepts', () => {
  assert.strictEqual(HC.cleanHost('WWW.Example.com'), 'www.example.com');
  assert.strictEqual(HC.cleanHost('https://www.example.com:8443/a?b'), 'www.example.com');
  assert.strictEqual(HC.cleanHost('example.com:3000'), 'example.com');
  assert.strictEqual(HC.cleanHost('not a host'), '');
  assert.strictEqual(HC.cleanHost(''), '');
});

test('Round trip: the built profile, as a share link and as JSON, imports as response rows with op set and the Domain filter', () => {
  const { res, out } = run(CHROME_RAW.replace('HTTP/1.1 200 OK', 'Request URL: https://shop.example.com/cart\nHTTP/1.1 200 OK'));
  assert.strictEqual(res.host, 'shop.example.com');
  const rows = HC.suggestions(res, out).filter((x) => x.on).map((x) => ({ name: x.name, value: x.value }));
  // An edited CSP with line breaks is folded onto one line (a header value cannot hold one).
  rows[0].value = "default-src 'self';\n  script-src 'self' 'nonce-abc'";
  const p = HC.buildProfile(rows, { host: res.host });
  const expected = [
    ['response', 'Content-Security-Policy-Report-Only', "default-src 'self'; script-src 'self' 'nonce-abc'", 'set'],
    ['response', 'Strict-Transport-Security', 'max-age=300', 'set'],
    ['response', 'X-Content-Type-Options', 'nosniff', 'set'],
    ['response', 'Referrer-Policy', 'strict-origin-when-cross-origin', 'set'],
  ];
  const shape = (prof) => prof.headers.map((h) => [h.target, h.name, h.value, h.op]);
  assert.deepStrictEqual(shape(p), expected);

  const link = HD.shareLink(p);
  assert.ok(link.startsWith('https://janwan2003.github.io/request-headers/share/#p='));
  const viaLink = HD.parseImport(link);
  assert.strictEqual(viaLink.source, 'HeaderDial');
  assert.strictEqual(viaLink.profiles.length, 1);
  const q = viaLink.profiles[0];
  assert.strictEqual(q.name, 'Security headers test (shop.example.com)');
  assert.deepStrictEqual(shape(q), expected);
  assert.ok(q.headers.every((h) => h.enabled && !HD.headerProblem(h)));
  assert.deepStrictEqual(q.filters.map((f) => [f.kind, f.type, f.value, HD.filterProblem(f)]), [['include', 'domain', 'shop.example.com', '']]);

  const viaFile = HD.parseImport(HD.exportJSON([p]));
  assert.deepStrictEqual(shape(viaFile.profiles[0]), expected);

  // The extension compiles it to one DNR rule that sets those response headers on that host.
  const rules = HD.compile({ profiles: [q] }, { now: NOW }).dynamic;
  assert.strictEqual(rules.length, 1);
  assert.deepStrictEqual(rules[0].condition.requestDomains, ['shop.example.com']);
  assert.deepStrictEqual(rules[0].action.responseHeaders.map((h) => [h.header, h.operation]), expected.map((e) => [e[1], 'set']));
  assert.strictEqual(rules[0].action.requestHeaders, undefined);

  // Without a host: no filter.
  assert.deepStrictEqual(HD.parseImport(HD.shareLink(HC.buildProfile(rows, { host: '' }))).profiles[0].filters, []);
});
