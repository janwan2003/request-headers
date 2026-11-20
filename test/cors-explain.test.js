'use strict';
const test = require('node:test');
const assert = require('node:assert');
const HD = require('../extension/lib/model.js');
require('../extension/lib/transfer.js');
const CE = require('../site/js/cors-explain.js');

// Console texts captured in Chrome 159 and Firefox 158 for guides/fix-cors-error-while-testing.html
// (page on 127.0.0.1, API on localhost). The URL and origin prefix is ours; the reasons are verbatim.
const PRE = "Access to fetch at 'http://localhost:8080/api/items' from origin 'http://127.0.0.1:3000' has been blocked by CORS policy: ";
const FF = 'Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at http://localhost:8080/api/items. ';
const NOCORS = " If an opaque response serves your needs, set the request's mode to 'no-cors' to fetch the resource with CORS disabled.";

const id = (t) => CE.explain(t).main && CE.explain(t).main.id;

test('Chrome: the seven measured reasons map to causes', () => {
  const cases = [
    ["No 'Access-Control-Allow-Origin' header is present on the requested resource." + NOCORS, 'missing-acao'],
    ["Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource." + NOCORS, 'preflight-missing-acao'],
    ['Request header field authorization is not allowed by Access-Control-Allow-Headers in preflight response.', 'header-not-allowed'],
    ['Method PUT is not allowed by Access-Control-Allow-Methods in preflight response.', 'method-not-allowed'],
    ["The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.", 'wildcard-credentials'],
    ["The value of the 'Access-Control-Allow-Credentials' header in the response is '' which must be 'true' when the request's credentials mode is 'include'.", 'credentials-not-true'],
    ["Response to preflight request doesn't pass access control check: It does not have HTTP ok status.", 'preflight-status'],
  ];
  for (const [reason, want] of cases) {
    const r = CE.explain(PRE + reason);
    assert.strictEqual(r.main.id, want, reason);
    assert.strictEqual(r.browser, 'chrome');
    assert.strictEqual(r.url, 'http://localhost:8080/api/items');
    assert.strictEqual(r.host, 'localhost');
    assert.strictEqual(r.origin, 'http://127.0.0.1:3000');
  }
  const h = CE.explain(PRE + cases[2][0]);
  assert.deepStrictEqual(h.needs.headers, ['Authorization']);
  assert.ok(h.preflight);
  assert.deepStrictEqual(CE.explain(PRE + cases[3][0]).needs.methods, ['PUT']);
  assert.ok(CE.explain(PRE + cases[4][0]).credentials);
  assert.ok(CE.explain(PRE + cases[0][0]).main.noCorsHint);
  assert.strictEqual(CE.explain(PRE + cases[6][0]).fixable, false);
  assert.strictEqual(CE.explain(PRE + cases[0][0]).fixable, true);
});

test('Firefox: the measured reasons map to causes; the follow-up "did not succeed" ranks last', () => {
  const cases = [
    ['(Reason: CORS header ‘Access-Control-Allow-Origin’ missing). Status code: 200.', 'missing-acao'],
    ['(Reason: header ‘authorization’ is not allowed according to header ‘Access-Control-Allow-Headers’ from CORS preflight response).', 'header-not-allowed'],
    ['(Reason: Did not find method in CORS header ‘Access-Control-Allow-Methods’).', 'method-not-allowed'],
    ['(Reason: Credential is not supported if the CORS header ‘Access-Control-Allow-Origin’ is ‘*’).', 'wildcard-credentials'],
    ['(Reason: expected ‘true’ in CORS header ‘Access-Control-Allow-Credentials’).', 'credentials-not-true'],
    ['(Reason: CORS preflight response did not succeed). Status code: 404.', 'preflight-status'],
    ['(Reason: CORS disabled).', 'disabled'],
  ];
  for (const [reason, want] of cases) {
    const r = CE.explain(FF + reason);
    assert.strictEqual(r.main.id, want, reason);
    assert.strictEqual(r.browser, 'firefox');
    assert.strictEqual(r.url, 'http://localhost:8080/api/items');
    assert.strictEqual(r.origin, '', 'Firefox does not name the page origin');
  }
  assert.strictEqual(CE.explain(FF + cases[5][0]).main.status, '404');
  // Firefox logs two lines for a failed preflight: the specific one wins.
  const two = CE.explain(FF + cases[0][0] + '\n' + FF + '(Reason: CORS request did not succeed). Status code: (null).');
  assert.strictEqual(two.messages.length, 2);
  assert.strictEqual(two.main.id, 'missing-acao');
  assert.strictEqual(two.fixable, true, 'did-not-succeed alone does not make it unfixable');
  const preflight404 = CE.explain(FF + cases[5][0] + '\n' + FF + '(Reason: CORS request did not succeed). Status code: (null).');
  assert.strictEqual(preflight404.main.id, 'preflight-status');
  assert.strictEqual(preflight404.fixable, false);
  // Header names come back canonical.
  assert.deepStrictEqual(CE.explain(FF + cases[1][0]).needs.headers, ['Authorization']);
});

test('a reason pasted without its start, a Network-panel label, and generic errors', () => {
  assert.strictEqual(id("No 'Access-Control-Allow-Origin' header is present on the requested resource."), 'missing-acao');
  assert.strictEqual(id('(Reason: CORS header ‘Access-Control-Allow-Origin’ missing). Status code: 200.'), 'missing-acao');
  assert.strictEqual(id('CORS Missing Allow Origin'), 'missing-acao');
  assert.strictEqual(id('TypeError: Failed to fetch'), 'generic');
  assert.strictEqual(id('TypeError: NetworkError when attempting to fetch resource.'), 'generic');
  assert.strictEqual(id('AxiosError: Network Error'), 'generic');
  assert.strictEqual(CE.explain('hello world').main, null);
  assert.strictEqual(CE.explain('').fixable, null);
  // With the real reason next to the generic error, the reason wins.
  assert.strictEqual(id('TypeError: Failed to fetch\n' + PRE + "No 'Access-Control-Allow-Origin' header is present on the requested resource."), 'missing-acao');
});

test('Chrome variants: XHR, redirected, mismatch, multiple values, file://, private network', () => {
  const xhr = CE.explain("Access to XMLHttpRequest at 'https://api.example.com/v1' from origin 'https://app.example.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.");
  assert.strictEqual(xhr.main.kind, 'XMLHttpRequest');
  assert.strictEqual(xhr.host, 'api.example.com');
  const red = CE.explain("Access to fetch at 'https://b.example.com/x' (redirected from 'https://a.example.com/x') from origin 'https://app.example.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.");
  assert.strictEqual(red.main.redirectedFrom, 'https://a.example.com/x');
  assert.strictEqual(red.url, 'https://b.example.com/x');
  const mm = CE.explain(PRE + "The 'Access-Control-Allow-Origin' header has a value 'http://example.com' that is not equal to the supplied origin.");
  assert.strictEqual(mm.main.id, 'origin-mismatch');
  assert.strictEqual(mm.main.value, 'http://example.com');
  assert.strictEqual(id(PRE + "The 'Access-Control-Allow-Origin' header contains multiple values 'http://127.0.0.1:3000, http://example.com', but only one is allowed."), 'multiple-acao');
  assert.strictEqual(id("Access to fetch at 'file:///home/me/data.json' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: chrome, chrome-extension, chrome-untrusted, data, http, https, isolated-app."), 'not-http');
  assert.strictEqual(id(PRE + 'Redirect is not allowed for a preflight request.'), 'preflight-redirect');
  assert.strictEqual(id(PRE + 'Permission was denied for this request to access the `loopback` address space.'), 'private-network');
});

test('Safari (WebKit strings): the common forms', () => {
  assert.strictEqual(id('Origin http://localhost:3000 is not allowed by Access-Control-Allow-Origin. Status code: 200'), 'missing-acao');
  assert.strictEqual(CE.explain('Origin http://localhost:3000 is not allowed by Access-Control-Allow-Origin. Status code: 200').origin, 'http://localhost:3000');
  assert.strictEqual(id('Preflight response is not successful. Status code: 405'), 'preflight-status');
  assert.strictEqual(id('Request header field X-Api-Key is not allowed by Access-Control-Allow-Headers.'), 'header-not-allowed');
  const two = CE.explain('Origin http://localhost:3000 is not allowed by Access-Control-Allow-Origin. Status code: 200\nFetch API cannot load https://api.example.com/v1 due to access control checks.');
  assert.strictEqual(two.main.id, 'missing-acao');
  assert.strictEqual(two.url, 'https://api.example.com/v1');
});

test('a message wrapped over several lines is joined', () => {
  const r = CE.explain("Access to fetch at 'http://localhost:8080/api/items' from origin\n'http://127.0.0.1:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check:\nNo 'Access-Control-Allow-Origin' header is present on the requested resource.");
  assert.strictEqual(r.messages.length, 1);
  assert.strictEqual(r.main.id, 'preflight-missing-acao');
});

test('responseHeaders: wildcard for simple, exact origin + credentials, lists for preflight', () => {
  assert.deepStrictEqual(CE.responseHeaders({}), [{ name: 'Access-Control-Allow-Origin', value: '*' }]);
  assert.deepStrictEqual(CE.responseHeaders({ origin: 'http://127.0.0.1:3000/', credentials: true }), [
    { name: 'Access-Control-Allow-Origin', value: 'http://127.0.0.1:3000' },
    { name: 'Access-Control-Allow-Credentials', value: 'true' },
    { name: 'Vary', value: 'Origin' }]);
  const pre = CE.responseHeaders({ origin: 'http://127.0.0.1:3000', preflight: true, headers: ['x-custom'], methods: ['PURGE'] });
  assert.deepStrictEqual(pre.map((r) => r.name), ['Access-Control-Allow-Origin', 'Access-Control-Allow-Methods', 'Access-Control-Allow-Headers', 'Vary']);
  assert.strictEqual(pre[1].value, 'GET, POST, PUT, PATCH, DELETE, OPTIONS, PURGE');
  assert.strictEqual(pre[2].value, 'X-Custom, Authorization, Content-Type');
  // Credentials without a known origin leave the value empty: the page must ask for it.
  assert.strictEqual(CE.responseHeaders({ credentials: true })[0].value, '');
});

test('snippets: Express, nginx, Apache, plain headers', () => {
  const rows = CE.responseHeaders({ origin: 'http://localhost:5173', credentials: true, preflight: true });
  const ex = CE.snippet(rows, 'express');
  assert.match(ex, /origin: 'http:\/\/localhost:5173'/);
  assert.match(ex, /credentials: true/);
  assert.match(ex, /methods: \['GET', 'POST', 'PUT', 'PATCH', 'DELETE'\]/);
  assert.match(ex, /app\.options\('\*'/);
  const ng = CE.snippet(rows, 'nginx');
  assert.match(ng, /if \(\$request_method = OPTIONS\) \{/);
  assert.match(ng, /add_header Access-Control-Allow-Credentials "true" always;/);
  assert.match(ng, /return 204;/);
  assert.match(CE.snippet(rows, 'apache'), /Header always set Access-Control-Allow-Origin "http:\/\/localhost:5173"/);
  assert.strictEqual(CE.snippet([{ name: 'Access-Control-Allow-Origin', value: '*' }], 'headers'), 'Access-Control-Allow-Origin: *');
  assert.doesNotMatch(CE.snippet([{ name: 'Access-Control-Allow-Origin', value: '*' }], 'nginx'), /OPTIONS/);
});

test('profile: response rows (no Vary), Domain filter on the API host, survives a share link', () => {
  const rows = CE.responseHeaders({ origin: 'http://127.0.0.1:3000', credentials: true, preflight: true });
  const p = CE.buildProfile(rows, 'localhost');
  assert.deepStrictEqual(p.headers.map((h) => [h.target, h.name, h.op]), [
    ['response', 'Access-Control-Allow-Origin', 'set'], ['response', 'Access-Control-Allow-Credentials', 'set'],
    ['response', 'Access-Control-Allow-Methods', 'set'], ['response', 'Access-Control-Allow-Headers', 'set']]);
  assert.deepStrictEqual(p.filters.map((f) => [f.kind, f.type, f.value]), [['include', 'domain', 'localhost']]);
  const back = HD.parseImport(HD.shareLink(p)).profiles[0];
  assert.deepStrictEqual(back.headers.map((h) => [h.name, h.value]), p.headers.map((h) => [h.name, h.value]));
  assert.strictEqual(back.filters[0].value, 'localhost');
  // It compiles to DNR modifyHeaders rules for the host.
  const out = HD.compile(HD.normalizeState({ schema: HD.SCHEMA, paused: false, selectedId: p.id, profiles: [p] }));
  const rules = out.dynamic.concat(out.session || []);
  assert.ok(rules.length >= 1);
  assert.ok(rules.every((r) => r.condition.requestDomains && r.condition.requestDomains.includes('localhost')));
  assert.deepStrictEqual(rules.flatMap((r) => r.action.responseHeaders.map((h) => h.header.toLowerCase())).sort(),
    ['access-control-allow-credentials', 'access-control-allow-headers', 'access-control-allow-methods', 'access-control-allow-origin']);
});

// Every console text below was captured from Chrome 159.0.8154.6 and Firefox 158.0.1 (3 runs each,
// identical; page on 127.0.0.1, API on localhost; ports normalised). Each scenario's full paste must
// explain to the expected main cause.
test('captured browser texts (test/fixtures/cors-messages.json) explain to the right cause', () => {
  const fx = require('./fixtures/cors-messages.json');
  const want = {
    's0-baseline-missing-acao': 'missing-acao', 's1-acao-other-origin': 'origin-mismatch',
    's2a-acao-two-values-one-line': 'multiple-acao', 's2b-acao-two-header-lines': 'multiple-acao',
    's3a-preflight-301': { chrome: 'preflight-redirect', firefox: 'redirect' }, 's3b-preflight-302': { chrome: 'preflight-redirect', firefox: 'redirect' },
    's4a-redirect-noacao-to-star': { chrome: 'missing-acao', firefox: 'redirect' }, 's4c-redirect-star-to-noacao': 'missing-acao',
    's4d-redirect-exact-to-exact': { chrome: 'redirect', firefox: 'origin-mismatch' },
    's5a-file-page-fetch-file': 'not-http', 's5b-file-page-fetch-http-nocors': 'missing-acao',
    's6a-xhr-missing-acao': 'missing-acao', 's6b-module-script-missing-acao': 'missing-acao', 's6c-font-face-missing-acao': 'missing-acao',
    's7a-cred-acac-false': 'credentials-not-true', 's7b-cred-acac-TRUE-uppercase': 'credentials-not-true', 's7c-cred-acac-missing': 'credentials-not-true',
    's7d-cred-acao-star': 'wildcard-credentials', 's8-preflight-cred-no-acac': 'credentials-not-true',
    's9a-connection-refused-localhost': { chrome: 'unreachable', firefox: 'did-not-succeed' }, 's9b-connection-refused-same-host': { chrome: 'unreachable', firefox: 'did-not-succeed' },
    's10-preflight-x-custom-not-allowed': 'header-not-allowed', 's11-lna-public-to-loopback': 'private-network',
  };
  let n = 0;
  for (const f of fx) {
    const w = want[f.scenario];
    assert.ok(w, 'expectation for ' + f.scenario);
    const id = typeof w === 'string' ? w : w[f.browser];
    // As pasted: all lines together, and also wrapped onto one line with spaces.
    for (const text of [f.messages.join('\n'), f.messages.join(' ')]) {
      const r = CE.explain(text);
      assert.strictEqual(r.main && r.main.id, id, `${f.scenario} (${f.browser}): ${text.slice(0, 160)}`);
      if (r.main.id !== 'unreachable') assert.match(r.url, /^http:\/\/(localhost|127\.0\.0\.[12]):(8080|9)\/|^file:/, f.scenario + ' url');
      n++;
    }
  }
  assert.ok(n >= 80, 'checked ' + n);
  // Details the fix needs.
  const get = (s, b) => CE.explain(fx.find((f) => f.scenario === s && f.browser === b).messages.join('\n'));
  assert.deepStrictEqual(get('s10-preflight-x-custom-not-allowed', 'chrome').needs.headers, ['X-Custom']);
  assert.strictEqual(get('s7d-cred-acao-star', 'firefox').url, 'http://localhost:8080/s7d', 'curly-quoted URL unwrapped');
  assert.ok(get('s7d-cred-acao-star', 'firefox').credentials);
  assert.strictEqual(get('s4c-redirect-star-to-noacao', 'chrome').main.redirectedFrom, 'http://localhost:8080/s4c');
  assert.strictEqual(get('s8-preflight-cred-no-acac', 'chrome').preflight, true);
  assert.strictEqual(get('s5b-file-page-fetch-http-nocors', 'chrome').origin, 'null');
  assert.strictEqual(CE.responseHeaders(get('s5b-file-page-fetch-http-nocors', 'chrome').needs)[0].value, '*', 'origin null → *');
  assert.strictEqual(get('s9a-connection-refused-localhost', 'chrome').fixable, false);
  assert.strictEqual(get('s3a-preflight-301', 'firefox').fixable, false);
});
