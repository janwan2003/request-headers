'use strict';
const test = require('node:test');
const assert = require('node:assert');
const HD = require('../extension/lib/model.js');
require('../extension/lib/transfer.js');
require('../extension/lib/paste.js');

const kept = (req) => req.items.filter((i) => i.keep).map((i) => (i.kind === 'cookie' ? 'cookie ' : '') + i.name + '=' + i.value);
const dropped = (req) => req.items.filter((i) => !i.keep).map((i) => i.name.toLowerCase());

// The shape Chrome DevTools writes for "Copy as cURL (bash)" (checked against the generator in
// devtools-frontend NetworkLogView.ts): --url first, lower-case names, one -H per line, cookies
// in -b, $'...' when a value holds a single quote.
const CHROME_BASH = String.raw`curl --url 'https://api.example.com/v1/me?x=1&y=2' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'accept-language: en-US,en;q=0.9' \
  -H 'authorization: Bearer eyJhbGciOi.abc.def' \
  -b 'sid=s%3A123; theme=dark' \
  -H 'priority: u=1, i' \
  -H 'referer: https://app.example.com/' \
  -H 'sec-ch-ua: "Chromium";v="159", "Not:A-Brand";v="24"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-site' \
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36' \
  -H $'x-note: it\'s "quoted"' \
  -H 'x-tenant: acme'`;

test('Chrome "Copy as cURL (bash)": keeps auth and X- headers, unticks what the browser sends itself', () => {
  const req = HD.parseRequestText(CHROME_BASH);
  assert.strictEqual(req.source, 'curl');
  assert.strictEqual(req.host, 'api.example.com');
  assert.strictEqual(req.fromBrowser, true);
  assert.deepStrictEqual(kept(req), ['authorization=Bearer eyJhbGciOi.abc.def', 'x-note=it\'s "quoted"', 'x-tenant=acme']);
  assert.deepStrictEqual(dropped(req), ['accept', 'accept-language', 'sid', 'theme', 'priority', 'referer', 'sec-ch-ua',
    'sec-ch-ua-mobile', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'user-agent']);
  const ua = req.items.find((i) => i.name === 'sec-ch-ua');
  assert.strictEqual(ua.value, '"Chromium";v="159", "Not:A-Brand";v="24"');
  const p = HD.profileFromRequest(req);
  assert.strictEqual(p.name, 'api.example.com (curl)');
  assert.deepStrictEqual(p.filters.map((f) => [f.kind, f.type, f.value]), [['include', 'domain', 'api.example.com']]);
  // The profile compiles: the three headers, only on that domain.
  const rules = HD.compile(HD.normalizeState({ profiles: [p] })).dynamic;
  assert.strictEqual(rules.length, 1);
  assert.deepStrictEqual(rules[0].action.requestHeaders.map((h) => h.header), ['authorization', 'x-note', 'x-tenant']);
  assert.deepStrictEqual(rules[0].condition.requestDomains, ['api.example.com']);
});

test('Chrome "Copy as cURL (cmd)" for Windows: released (\\^") and newer ("") quote escaping', () => {
  const cmd = [
    'curl ^"https://api.example.com/v1/items?q=a^%^20b^" ^',
    '  -H ^"accept: */*^" ^',
    '  -H ^"authorization: Bearer t0k^" ^',
    '  -b ^"sid=1; other=2^" ^',
    '  -H ^"sec-fetch-mode: cors^" ^',
    '  -H ^"x-json: ^{^\\^"a^\\^":1^}^" ^',
    '  --data-raw ^"^{^\\^"name^\\^":^\\^"O\'Brien^\\^",^\\^"tags^\\^":^[^\\^"a^\\^",^\\^"b^\\^"^]^}^"',
  ].join('\n');
  const req = HD.parseRequestText(cmd);
  assert.strictEqual(req.url, 'https://api.example.com/v1/items?q=a%20b');
  assert.strictEqual(req.method, 'POST', 'a body without -X means POST');
  assert.deepStrictEqual(kept(req), ['authorization=Bearer t0k', 'x-json={"a":1}']);
  assert.deepStrictEqual(kept(HD.parseRequestText(cmd.replace(/\n/g, '\r\n'))), kept(req), 'CRLF too');
  // Chrome's main branch writes an embedded quote as "" (verbatim generator output).
  const main = 'curl --url ^"https://api.example.com/v1/me?x=1^&y=2^" ^\n  -H ^"authorization: Bearer abc.def^" ^\n' +
    '  -b ^"sid=s^%^3A1; theme=dark^" ^\n  -H ^"x-note: it\'s ^"^"quoted^"^"^"';
  const r2 = HD.parseRequestText(main);
  assert.strictEqual(r2.url, 'https://api.example.com/v1/me?x=1&y=2');
  assert.deepStrictEqual(kept(r2), ['authorization=Bearer abc.def', 'cookie sid=s%3A1', 'cookie theme=dark', 'x-note=it\'s "quoted"']);
});

test('curl globbing escapes in the URL are undone', () => {
  assert.strictEqual(HD.parseRequestText(String.raw`curl --url 'https://a.test/p?a\[0\]=1' -H 'x: 1'`).url, 'https://a.test/p?a[0]=1');
});

test('Firefox "Copy as cURL" (POSIX, verbatim generator layout): Title-Case names, --compressed, Cookie as a header', () => {
  const multi = "curl 'https://api.example.com/v1/me' \\\n  --compressed \\\n  -H 'Authorization: Bearer abc.def' \\\n" +
    "  -H 'Cookie: sid=s%3A1; theme=dark' \\\n  -H $'X-Note: it\\'s \"quoted\"' \\\n  -H 'Sec-Fetch-Mode: cors'";
  assert.deepStrictEqual(kept(HD.parseRequestText(multi)), ['Authorization=Bearer abc.def', 'X-Note=it\'s "quoted"']);

  const ff = "curl 'https://api.example.com/v1/me' --compressed -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64; rv:158.0) Gecko/20100101 Firefox/158.0' " +
    "-H 'Accept: */*' -H 'Accept-Encoding: gzip, deflate, br, zstd' -H 'Authorization: Bearer ff' -H 'Connection: keep-alive' " +
    "-H 'Cookie: sid=9' -H 'Sec-Fetch-Dest: empty' -H 'Sec-Fetch-Mode: cors' -H 'Sec-Fetch-Site: same-origin' -H 'TE: trailers'";
  const req = HD.parseRequestText(ff);
  assert.deepStrictEqual(kept(req), ['Authorization=Bearer ff']);
  assert.ok(dropped(req).includes('sid'));
});

test('Firefox "Copy as cURL" writes & and | as ^& and ^| inside quotes; Chrome copies keep a literal ^&', () => {
  const ff = "curl 'https://api.example.com/q?a=1^&b=2' -H 'X-Filter: a^&b^|c' -H 'Cookie: s=1' -H 'Sec-Fetch-Mode: cors'";
  const req = HD.parseRequestText(ff);
  assert.strictEqual(req.url, 'https://api.example.com/q?a=1&b=2');
  assert.deepStrictEqual(kept(req), ['X-Filter=a&b|c']);
  const chrome = "curl 'https://api.example.com/' -H 'x-filter: a^&b' -H 'sec-fetch-mode: cors'";
  assert.deepStrictEqual(kept(HD.parseRequestText(chrome)), ['x-filter=a^&b']);
});

test('hand-written curl: everything it asks for is kept, -u becomes Basic auth, the body is left out', () => {
  const req = HD.parseRequestText(`$ curl -sSL -u alice:s3cret -H "X-Env: staging" -A 'MyAgent/1' --cookie 'flag=on' -H 'X-Drop:' -H 'X-Empty;' https://api.example.com/x -d '{"a":1}'`);
  assert.strictEqual(req.fromBrowser, false);
  assert.deepStrictEqual(kept(req), ['Authorization=Basic ' + Buffer.from('alice:s3cret').toString('base64'), 'X-Env=staging',
    'User-Agent=MyAgent/1', 'cookie flag=on', 'X-Drop=', 'X-Empty=']);
  assert.ok(req.items.find((i) => i.name === 'X-Drop').remove);
  assert.match(req.notes.join(' '), /body was left out/);
  const p = HD.profileFromRequest(req);
  assert.deepStrictEqual(p.headers.map((h) => [h.name, h.op]), [['Authorization', 'set'], ['X-Env', 'set'], ['User-Agent', 'set'],
    ['X-Drop', 'remove'], ['X-Empty', 'set']]);
  assert.deepStrictEqual(p.cookies.map((c) => [c.target, c.name, c.value]), [['request', 'flag', 'on']]);
  assert.strictEqual(HD.profileFromRequest(req, { onlyHost: false }).filters.length, 0);
});

test('a later -H with the same name wins; a URL after --url= is read', () => {
  const req = HD.parseRequestText("curl --url=https://a.test/ -H 'X-A: 1' -H 'X-A: 2' --oauth2-bearer tok");
  assert.strictEqual(req.host, 'a.test');
  assert.deepStrictEqual(kept(req), ['X-A=2', 'Authorization=Bearer tok']);
});

test('round trip: HeaderDial\'s own "Copy as curl…" output imports back', () => {
  const p = HD.normalizeProfile(HD.newProfile(0, {
    headers: [HD.newHeader('request', { name: 'X-A', value: "it's" }), HD.newHeader('request', { name: 'X-Gone', op: 'remove' }),
      HD.newHeader('response', { name: 'X-Resp', value: '1' })],
    cookies: [HD.newCookie('request', { name: 'c', value: '1' })] }), 0);
  const text = HD.curlCommand(p, 'https://site.test/path');
  assert.match(text, /^# not in curl/);
  const req = HD.parseRequestText(text);
  assert.ok(req, 'recognised despite the leading comment line');
  assert.deepStrictEqual(kept(req), ["X-A=it's", 'X-Gone=', 'cookie c=1']);
  const back = HD.profileFromRequest(req);
  assert.deepStrictEqual(back.headers.map((h) => [h.name, h.op, h.value]), [['X-A', 'set', "it's"], ['X-Gone', 'remove', '']]);
});

test('DevTools "Copy as fetch"', () => {
  const f = `fetch("https://api.example.com/graphql", {
  "headers": {
    "accept": "*/*",
    "authorization": "Bearer gql",
    "content-type": "application/json",
    "sec-fetch-mode": "cors",
    "x-apollo-operation-name": "Me"
  },
  "referrer": "https://app.example.com/",
  "body": "{\\"query\\":\\"{ me { id } }\\"}",
  "method": "POST",
  "mode": "cors",
  "credentials": "include"
});`;
  const req = HD.parseRequestText(f);
  assert.strictEqual(req.source, 'fetch');
  assert.strictEqual(req.method, 'POST');
  assert.deepStrictEqual(kept(req), ['authorization=Bearer gql', 'x-apollo-operation-name=Me']);
  assert.ok(dropped(req).includes('content-type'));
  // Chrome's "Copy as fetch (Node.js)": no mode or credentials, cookie among the headers, body: null.
  const node = 'fetch("https://api.example.com/v1/me", {\n  "headers": {\n    "authorization": "Bearer n",\n    "cookie": "sid=1"\n  },\n  "body": null,\n  "method": "GET"\n});';
  assert.deepStrictEqual(kept(HD.parseRequestText(node)), ['authorization=Bearer n']);
  const ff = 'await fetch("https://a.test/", {\n    "credentials": "include",\n    "headers": {\n        "X-Key": "k"\n    },\n    "method": "GET",\n    "mode": "cors"\n});';
  assert.deepStrictEqual(kept(HD.parseRequestText(ff)), ['X-Key=k']);
});

test('raw header lines, HTTP/1.1 and HTTP/2 forms', () => {
  const h1 = HD.parseRequestText('GET /v1/me HTTP/1.1\nHost: api.example.com\nAuthorization: Bearer h1\nAccept: */*\nSec-Fetch-Mode: cors');
  assert.strictEqual(h1.url, 'https://api.example.com/v1/me');
  assert.deepStrictEqual(kept(h1), ['Authorization=Bearer h1']);
  const h2 = HD.parseRequestText(':authority: api.example.com\n:method: GET\n:path: /v2\n:scheme: https\nx-api-key: k2\nuser-agent: Mozilla/5.0');
  assert.strictEqual(h2.host, 'api.example.com');
  assert.deepStrictEqual(kept(h2), ['x-api-key=k2', 'user-agent=Mozilla/5.0'], 'no sec-fetch, so not treated as a browser copy');
  assert.deepStrictEqual(kept(HD.parseRequestText('X-One: 1')), ['X-One=1']);
  assert.strictEqual(HD.parseRequestText('just some words\nand more'), null);
});

test('a JSON object of headers imports; HeaderDial and ModHeader JSON still take their own path', () => {
  const r = HD.parseImport('{"Authorization": "Bearer j", "X-Env": "qa"}');
  assert.strictEqual(r.source, 'pasted headers');
  assert.deepStrictEqual(r.profiles[0].headers.map((h) => h.name + '=' + h.value), ['Authorization=Bearer j', 'X-Env=qa']);
  assert.strictEqual(r.profiles[0].filters.length, 0, 'no URL, so no domain filter');
  assert.deepStrictEqual(HD.parseImport('{"headers": {"X-K": "1"}}').profiles[0].headers.map((h) => h.name), ['X-K']);
  assert.strictEqual(HD.parseImport(HD.exportJSON([HD.newProfile(0)])).source, 'HeaderDial');
  assert.strictEqual(HD.parseImport('[{"title":"P","headers":[{"name":"A","value":"1","enabled":true}]}]').source, 'ModHeader');
  assert.throws(() => HD.parseImport('hello there'), /Unrecognised format/);
  assert.throws(() => HD.parseImport('{"a": '), /not valid JSON/);
});

test('parseImport turns a curl command into one profile and says when nothing is left', () => {
  const r = HD.parseImport(CHROME_BASH);
  assert.strictEqual(r.source, 'a curl command');
  assert.strictEqual(r.profiles.length, 1);
  assert.throws(() => HD.parseImport("curl 'https://a.test/' -H 'sec-fetch-mode: cors' -H 'accept: */*'"), /Nothing to import/);
  assert.throws(() => HD.parseImport("curl 'https://a.test/ -H x"), /Unclosed ' quote/);
});
