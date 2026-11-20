// CORS error explainer: reads the console lines Chrome/Edge, Firefox and Safari log for a
// blocked cross-origin request, says what each one means, whether response headers can
// fix it, and works out the headers the server (or a HeaderDial test profile) must send.
// Chrome and Firefox texts were captured from Chrome 159 and Firefox 158 (fixtures in
// test/cors-explain.test.js); Safari texts follow WebKit's message strings and were not
// captured in Safari. Runs in the page and in Node (tests); needs model.js for profiles.
(function (root) {
  'use strict';

  const Q = "['‘’\"`]";           // Firefox uses curly quotes, Chrome straight ones
  const NQ = "[^'‘’\"`]";

  // Default lists when the error does not name a method or header.
  const DEFAULT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
  const DEFAULT_HEADERS = ['Authorization', 'Content-Type'];
  // Methods and headers that never need to be allowed (CORS-safelisted).
  const SIMPLE_METHODS = ['GET', 'HEAD', 'POST'];

  // Each cause: what it means, whether the request reached the server, whether added
  // response headers can fix it. `needs` says what the response must carry.
  const CAUSES = {
    'missing-acao': {
      title: 'The response has no Access-Control-Allow-Origin header',
      what: 'The request reached the server and it answered, but the answer does not say your page\'s origin may read it, so the browser hides the response from your code. The server did run the request (a POST or DELETE still took effect).',
      reached: 'yes', fixable: true },
    'preflight-missing-acao': {
      title: 'The preflight (OPTIONS) answer has no Access-Control-Allow-Origin header',
      what: 'Your request needs a preflight: it sends a header such as Authorization or a JSON Content-Type, or uses a method such as PUT or DELETE. The browser first asked the server with an OPTIONS request, and that answer had no CORS headers, so the real request was never sent.',
      reached: 'preflight', fixable: true },
    'header-not-allowed': {
      title: 'A request header is not in Access-Control-Allow-Headers',
      what: 'The preflight answer allows your origin but not a header your code sends. The real request was never sent.',
      reached: 'preflight', fixable: true },
    'method-not-allowed': {
      title: 'The method is not in Access-Control-Allow-Methods',
      what: 'The preflight answer allows your origin but not the request\'s method. The real request was never sent.',
      reached: 'preflight', fixable: true },
    'wildcard-credentials': {
      title: 'Access-Control-Allow-Origin is * but the request sends credentials',
      what: 'Your code sends cookies or HTTP auth (fetch with credentials: \'include\', or xhr.withCredentials = true). For such a request the answer must name your exact origin; * is refused.',
      reached: 'yes', fixable: true, credentials: true },
    'credentials-not-true': {
      title: 'Access-Control-Allow-Credentials is not "true"',
      what: 'Your code sends cookies or HTTP auth, and the answer names your origin but does not say Access-Control-Allow-Credentials: true.',
      reached: 'yes', fixable: true, credentials: true },
    'origin-mismatch': {
      title: 'Access-Control-Allow-Origin names a different origin',
      what: 'The answer allows one origin, and it is not your page\'s. An origin is scheme, host and port: http://localhost:3000 and http://127.0.0.1:3000 are different, and so are http and https, or a trailing slash.',
      reached: 'yes', fixable: true },
    'multiple-acao': {
      title: 'Access-Control-Allow-Origin has more than one value',
      what: 'The header may hold exactly one origin (or *). A list, or the header sent twice (often once by the app and once by a proxy or CDN), is refused.',
      reached: 'yes', fixable: true },
    'invalid-acao': {
      title: 'Access-Control-Allow-Origin has an invalid value',
      what: 'The header must be one origin such as https://app.example.com, or *. Paths, a trailing slash or wildcards inside a host do not work.',
      reached: 'yes', fixable: true },
    'preflight-status': {
      title: 'The preflight (OPTIONS) request got an error status',
      what: 'The server answered the OPTIONS preflight with an error, typically 404 or 405 because no route handles OPTIONS, or 401 because auth middleware runs before CORS. A preflight needs a 2xx status. The real request was never sent.',
      reached: 'preflight', fixable: false },
    'preflight-redirect': {
      title: 'The preflight (OPTIONS) request was redirected',
      what: 'The OPTIONS answer was a redirect (often http to https, or a missing or extra trailing slash). Browsers do not follow redirects for a preflight.',
      reached: 'preflight', fixable: false },
    'redirect': {
      title: 'The request was redirected and the redirect broke CORS',
      what: 'The answer was a redirect (3xx) that did not pass the CORS check. If it answered a preflight, browsers never follow it. If it answered the request itself, the redirect response needs CORS headers too, and after a redirect to another origin the browser sends Origin: null, so a target that names your origin no longer matches (in our tests only * on both hops worked).',
      reached: 'yes', fixable: false },
    'not-http': {
      title: 'The page or the resource is not on http(s)',
      what: 'The page was opened from a file (file://) or the URL uses a scheme CORS does not cover. Chrome and Edge do not let a file:// page fetch files (Firefox 158 did, in our test), and every call from a file:// page has the origin null. Serve the folder over http instead.',
      reached: 'no', fixable: false },
    'unreachable': {
      title: 'The server could not be reached (not a CORS problem)',
      what: 'Chrome logs only a network error such as net::ERR_CONNECTION_REFUSED, with no CORS line: the server is not running, the port or host is wrong, or the certificate is not trusted. Your code still sees "Failed to fetch", which is why it looks like CORS.',
      reached: 'no', fixable: false },
    'did-not-succeed': {
      title: 'The request did not succeed',
      what: 'Firefox logs this after another CORS reason (look for a second line), or when the server could not be reached at all: wrong port, server not running, DNS or TLS failure. With Status code: (null) and no other CORS line, check that the URL opens in a tab.',
      reached: 'unknown', fixable: false },
    'disabled': {
      title: 'CORS is turned off in this Firefox',
      what: 'The about:config preference content.cors.disable is true. Despite the name, that blocks every cross-origin request. Set it back to false.',
      reached: 'no', fixable: false },
    'mode': {
      title: 'The request mode does not allow cross-origin requests',
      what: 'The request was made with mode: \'same-origin\' (or a mode that forbids cross-origin requests), so the browser refused it before sending. Change the mode in your code.',
      reached: 'no', fixable: false },
    'private-network': {
      title: 'Chrome blocked a request to a local or private network address',
      what: 'A page on a more public address (a website) asked for a resource on a private address (localhost, 192.168.x.x, 10.x.x.x). Chrome\'s Private / Local Network Access protection decides this, not the CORS headers alone: the page must be on https, and Chrome may ask the user for permission or require Access-Control-Allow-Private-Network: true in the preflight answer.',
      reached: 'unknown', fixable: false },
    'access-control-checks': {
      title: 'Safari: blocked "due to access control checks"',
      what: 'Safari\'s short form. It does not say which check failed; the line before it in the console usually does (for example "Origin … is not allowed by Access-Control-Allow-Origin").',
      reached: 'unknown', fixable: null },
    'generic': {
      title: 'This is the error your code sees, not the reason',
      what: 'Failed to fetch, NetworkError, Load failed and Axios\'s Network Error all hide the reason on purpose. The console line just above it (Chrome: "Access to fetch at … has been blocked by CORS policy", Firefox: "Cross-Origin Request Blocked") says what failed. Paste that line.',
      reached: 'unknown', fixable: null },
  };

  const unq = (s) => String(s || '').replace(/^['‘’"`]|['‘’"`]$/g, '');
  const re = (s, f) => new RegExp(s.replace(/~/g, Q).replace(/%/g, NQ), f || 'i'); // ~ = a quote, % = not a quote

  // ---- Chrome / Edge reasons (after "has been blocked by CORS policy:")
  const CHROME = [
    [re("No ~Access-Control-Allow-Origin~ header is present"), (m, pre) => ({ id: pre ? 'preflight-missing-acao' : 'missing-acao' })],
    [re("must not be the wildcard ~\\*~ when the request.s credentials mode is ~include~"), () => ({ id: 'wildcard-credentials' })],
    [re("~Access-Control-Allow-Credentials~ header in the response is ~(%*)~ which must be ~true~"), (m) => ({ id: 'credentials-not-true', value: m[1] })],
    [re("~Access-Control-Allow-Origin~ header has a value ~(%*)~ that is not equal to the supplied origin"), (m) => ({ id: 'origin-mismatch', value: m[1] })],
    [re("~Access-Control-Allow-Origin~ header contains multiple values ~(%*)~"), (m) => ({ id: 'multiple-acao', value: m[1] })],
    [re("~Access-Control-Allow-Origin~ header contains the invalid value ~(%*)~"), (m) => ({ id: 'invalid-acao', value: m[1] })],
    [/Request header field (\S+) is not allowed by Access-Control-Allow-Headers/i, (m) => ({ id: 'header-not-allowed', header: m[1] })],
    [/Method (\S+) is not allowed by Access-Control-Allow-Methods/i, (m) => ({ id: 'method-not-allowed', method: m[1] })],
    [/does not have HTTP ok status/i, () => ({ id: 'preflight-status' })],
    [/Redirect is not allowed for a preflight request/i, () => ({ id: 'preflight-redirect' })],
    [/Cross origin requests are only supported for protocol schemes/i, () => ({ id: 'not-http' })],
    [/Cross origin requests are not allowed by request mode/i, () => ({ id: 'mode' })],
    [/address space|Private-Network|private network|local network/i, () => ({ id: 'private-network' })],
    [/Cannot parse Access-Control-Allow-(Methods|Headers)/i, (m) => ({ id: m[1].toLowerCase() === 'methods' ? 'method-not-allowed' : 'header-not-allowed' })],
  ];

  // ---- Firefox reasons (inside "(Reason: …)")
  const FIREFOX = [
    [re("CORS header ~Access-Control-Allow-Origin~ missing"), () => ({ id: 'missing-acao' })],
    [re("Credential is not supported if the CORS header ~Access-Control-Allow-Origin~ is ~\\*~"), () => ({ id: 'wildcard-credentials' })],
    [re("expected ~true~ in CORS header ~Access-Control-Allow-Credentials~"), () => ({ id: 'credentials-not-true' })],
    [re("CORS header ~Access-Control-Allow-Origin~ does not match ~(%*)~"), (m) => ({ id: 'origin-mismatch', value: m[1] })],
    [re("Multiple CORS header ~Access-Control-Allow-Origin~ not allowed"), () => ({ id: 'multiple-acao' })],
    [re("header ~(%+)~ is not allowed according to header ~Access-Control-Allow-Headers~"), (m) => ({ id: 'header-not-allowed', header: m[1] })],
    [re("missing token ~(%+)~ in CORS header ~Access-Control-Allow-Headers~"), (m) => ({ id: 'header-not-allowed', header: m[1] })],
    [re("invalid token ~(%+)~ in CORS header ~Access-Control-Allow-(Methods|Headers)~"), (m) => ({ id: /methods/i.test(m[2]) ? 'method-not-allowed' : 'header-not-allowed' })],
    [re("Did not find method in CORS header ~Access-Control-Allow-Methods~"), () => ({ id: 'method-not-allowed' })],
    [/CORS preflight response did not succeed/i, () => ({ id: 'preflight-status' })],
    [/CORS preflight channel did not succeed/i, () => ({ id: 'preflight-status' })],
    [/CORS request external redirect not allowed/i, () => ({ id: 'redirect' })],
    [/CORS request not HTTP/i, () => ({ id: 'not-http' })],
    [/CORS request did not succeed/i, () => ({ id: 'did-not-succeed' })],
    [/CORS disabled/i, () => ({ id: 'disabled' })],
  ];

  // Firefox's Network panel shows short labels such as "CORS Missing Allow Origin".
  const FIREFOX_LABELS = [
    [/CORS\s*Missing\s*Allow\s*Origin/i, 'missing-acao'], [/CORS\s*Preflight\s*Did\s*Not\s*Succeed/i, 'preflight-status'],
    [/CORS\s*Allow\s*Origin\s*Not\s*Matching\s*Origin/i, 'origin-mismatch'], [/CORS\s*Multiple\s*Allow\s*Origin/i, 'multiple-acao'],
    [/CORS\s*Missing\s*Allow\s*Credentials/i, 'credentials-not-true'], [/CORS\s*Not\s*Supporting\s*Credentials/i, 'wildcard-credentials'],
    [/CORS\s*Method\s*Not\s*Found/i, 'method-not-allowed'], [/CORS\s*Missing\s*Allow\s*Header/i, 'header-not-allowed'],
    [/CORS\s*Did\s*Not\s*Succeed/i, 'did-not-succeed'], [/CORS\s*Request\s*Not\s*Http/i, 'not-http'],
    [/CORS\s*External\s*Redirect\s*Not\s*Allowed/i, 'redirect'], [/CORS\s*Disabled/i, 'disabled'],
  ];

  // ---- Safari (WebKit) messages, matched on the whole line
  const SAFARI = [
    [/Origin (\S+) is not allowed by Access-Control-Allow-Origin\.?(?: Status code: (\d+))?/i, (m) => ({ id: 'missing-acao', origin: m[1], status: m[2] || '' })],
    [/Request header field (\S+) is not allowed by Access-Control-Allow-Headers\.?$/i, (m) => ({ id: 'header-not-allowed', header: m[1] })],
    [/Method (\S+) is not allowed by Access-Control-Allow-Methods\.?$/i, (m) => ({ id: 'method-not-allowed', method: m[1] })],
    [/Preflight response is not successful\.?(?: Status code: (\d+))?/i, (m) => ({ id: 'preflight-status', status: m[1] || '' })],
    [/Cannot use wildcard in Access-Control-Allow-Origin when credentials flag is true/i, () => ({ id: 'wildcard-credentials' })],
    [/Credentials flag is true, but Access-Control-Allow-Credentials is not/i, () => ({ id: 'credentials-not-true' })],
    [/(?:Fetch API|XMLHttpRequest) cannot load (\S+?)\.? due to access control checks/i, (m) => ({ id: 'access-control-checks', url: m[1] })],
  ];

  const GENERIC = /Failed to fetch|NetworkError when attempting to fetch|net::ERR_FAILED|^\s*(?:TypeError: )?Load failed|AxiosError|ERR_NETWORK|Network Error/i;

  function originOf(u) { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : (x.protocol === 'file:' ? 'null' : ''); } catch (e) { return ''; } }
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }

  // Split the paste into messages. A message starts at a known opener; DevTools copies
  // may wrap one message over several lines, so lines without an opener join the last.
  const OPENER = /Access to .+? at |Cross-Origin Request Blocked|(?:Fetch API|XMLHttpRequest) cannot load|^\s*Origin \S+ is not allowed|Preflight response is not successful|Request header field|^\s*Method \S+ is not allowed|Cannot use wildcard|Credentials flag is true|Failed to fetch|NetworkError when|net::ERR_|Load failed|AxiosError|Network Error|CORS\s*[A-Z][a-z]+\s*[A-Z]/;
  function splitMessages(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (!out.length || OPENER.test(line)) out.push(line); else out[out.length - 1] += ' ' + line;
    }
    return out;
  }

  function firefox(line, url, reason, status) {
    const r = { browser: 'firefox', url, origin: '', reason, status: status || '', text: line };
    for (const [rx, f] of FIREFOX) { const mm = reason.match(rx); if (mm) { Object.assign(r, f(mm)); break; } }
    if (!r.id) r.id = 'unknown';
    // Firefox reports two Access-Control-Allow-Origin values as "does not match 'a, b'".
    if (r.id === 'origin-mismatch' && /,/.test(r.value || '')) r.id = 'multiple-acao';
    // A redirect answer without CORS headers shows as "missing" with a 3xx status.
    if (r.id === 'missing-acao' && /^3\d\d$/.test(r.status)) r.id = 'redirect';
    r.preflight = /^(header-not-allowed|method-not-allowed|preflight-status)$/.test(r.id);
    return r;
  }

  /** Read one console message. Returns null if it is not a CORS-related message. */
  function parseMessage(line) {
    let m = line.match(/Access to (.+?) at '([^']+)'(?: \(redirected from '([^']+)'\))? from origin '([^']*)' has been blocked by CORS policy:\s*(.*)$/i);
    if (m) {
      const reason = m[5];
      const pre = /Response to preflight request doesn.t pass access control check/i.test(reason);
      const r = { browser: 'chrome', kind: m[1], url: m[2], redirectedFrom: m[3] || '', origin: m[4], preflight: pre, reason, text: line };
      for (const [rx, f] of CHROME) { const mm = reason.match(rx); if (mm) { Object.assign(r, f(mm, pre)); break; } }
      if (!r.id) r.id = 'unknown';
      if (r.id === 'origin-mismatch' && r.redirectedFrom && unq(r.value) === r.origin) r.id = 'redirect';
      if (r.id === 'header-not-allowed' || r.id === 'method-not-allowed' || r.id === 'preflight-status' || r.id === 'preflight-redirect') r.preflight = true;
      if (/set the request.s mode to .no-cors./i.test(reason)) r.noCorsHint = true;
      return r;
    }
    m = line.match(/Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at (\S+?)\.?\s+\(Reason:\s*([^)]+)\)\.?(?:\s*Status code:\s*(\d+|\(null\)))?/i);
    if (m) return firefox(line, unq(m[1]), m[2], m[3]);
    // A bare Firefox reason without the "Cross-Origin Request Blocked" start.
    m = line.match(/\(Reason:\s*([^)]+)\)\.?(?:\s*Status code:\s*(\d+|\(null\)))?/i);
    if (m) { const r = firefox(line, '', m[1], m[2]); if (r.id !== 'unknown') return r; }
    for (const [rx, f] of SAFARI) {
      const mm = line.match(rx);
      if (mm) { const r = Object.assign({ browser: 'safari', url: '', origin: '', reason: line, text: line }, f(mm)); r.preflight = /^(header-not-allowed|method-not-allowed|preflight-status)$/.test(r.id); return r; }
    }
    // Chrome's reason alone, without the "Access to … at" start.
    for (const [rx, f] of CHROME) {
      const mm = line.match(rx);
      if (mm) { const pre = /preflight/i.test(line); const r = Object.assign({ browser: 'chrome', url: '', origin: '', preflight: pre, reason: line, text: line }, f(mm, pre)); if (/^(header-not-allowed|method-not-allowed|preflight-status|preflight-redirect)$/.test(r.id)) r.preflight = true; return r; }
    }
    for (const [rx, id] of FIREFOX_LABELS) if (rx.test(line)) return { browser: 'firefox', id, url: '', origin: '', reason: line, text: line, preflight: /^(header-not-allowed|method-not-allowed|preflight-status)$/.test(id), label: true };
    if (/net::ERR_(?!FAILED)[A-Z_]+/.test(line) && !/CORS/i.test(line)) return { browser: 'chrome', id: 'unreachable', url: '', origin: '', reason: line, text: line, error: line.match(/net::ERR_[A-Z_]+/)[0] };
    if (GENERIC.test(line)) return { browser: /Failed to fetch|net::ERR/i.test(line) ? 'chrome' : /NetworkError/i.test(line) ? 'firefox' : /Load failed/i.test(line) ? 'safari' : '', id: 'generic', url: '', origin: '', reason: line, text: line };
    return null;
  }

  function uniq(list) { const seen = new Set(), out = []; for (const x of list) { const k = x.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x); } } return out; }
  function canonHeader(h) { return String(h).toLowerCase().replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase()); }

  /**
   * Explain a paste of one or more console messages.
   * Returns { messages, url, host, origin, browser, credentials, preflight, fixable, needs }.
   * `needs` is what the response must carry: { origin, credentials, methods, headers }.
   * The `main` message is the most specific one (generic errors and Firefox's
   * "did not succeed" follow-up rank last).
   */
  function explain(text) {
    const messages = [];
    for (const line of splitMessages(text)) { const r = parseMessage(line); if (r) messages.push(r); }
    const rank = (r) => (r.id === 'generic' ? 3 : r.id === 'did-not-succeed' || r.id === 'access-control-checks' ? 2 : r.id === 'unknown' ? 1 : 0);
    const sorted = messages.slice().sort((a, b) => rank(a) - rank(b));
    const main = sorted[0] || null;
    const url = (messages.find((r) => r.url) || {}).url || '';
    const origin = (messages.find((r) => r.origin) || {}).origin || '';
    const ids = new Set(messages.map((r) => r.id));
    const credentials = messages.some((r) => (CAUSES[r.id] || {}).credentials);
    const preflight = messages.some((r) => r.preflight);
    const methods = uniq(messages.filter((r) => r.method).map((r) => r.method.toUpperCase()));
    const headers = uniq(messages.filter((r) => r.header).map((r) => canonHeader(r.header)));
    const blockers = messages.filter((r) => CAUSES[r.id] && CAUSES[r.id].fixable === false && r.id !== 'did-not-succeed');
    const known = messages.filter((r) => CAUSES[r.id] && CAUSES[r.id].fixable === true);
    return {
      messages, main, url, host: hostOf(url), origin, browser: main ? main.browser : '',
      credentials, preflight, ids: [...ids],
      fixable: blockers.length ? false : known.length ? true : null,
      needs: { origin, credentials, methods, headers, preflight },
    };
  }

  /**
   * The response headers that fix the CORS part, from what the error said plus what the
   * user tells us. o: { origin, credentials, methods: [], headers: [], preflight }.
   * Returns [{ name, value }].
   */
  function responseHeaders(o) {
    o = o || {};
    const origin = String(o.origin || '').trim().replace(/\/+$/, '');
    const creds = !!o.credentials;
    const out = [{ name: 'Access-Control-Allow-Origin', value: origin && origin !== 'null' ? origin : creds ? (origin || '') : '*' }];
    if (creds) out.push({ name: 'Access-Control-Allow-Credentials', value: 'true' });
    if (o.preflight || (o.methods && o.methods.length) || (o.headers && o.headers.length)) {
      const methods = uniq(DEFAULT_METHODS.concat((o.methods || []).map((x) => String(x).toUpperCase())));
      const hdrs = uniq((o.headers || []).map(canonHeader).concat(DEFAULT_HEADERS));
      out.push({ name: 'Access-Control-Allow-Methods', value: methods.join(', ') });
      out.push({ name: 'Access-Control-Allow-Headers', value: hdrs.join(', ') });
    }
    if (origin && origin !== '*') out.push({ name: 'Vary', value: 'Origin' });
    return out;
  }

  /** Server snippets for the headers: 'express', 'nginx', 'apache', 'headers'. */
  function snippet(rows, fmt) {
    const get = (n) => (rows.find((r) => r.name === n) || {}).value;
    const ao = get('Access-Control-Allow-Origin') || '*', ac = get('Access-Control-Allow-Credentials');
    const am = get('Access-Control-Allow-Methods'), ah = get('Access-Control-Allow-Headers');
    if (fmt === 'express') {
      const opts = ['origin: ' + (ao === '*' ? "'*'" : "'" + ao + "'")];
      if (ac) opts.push('credentials: true');
      if (am) opts.push('methods: [' + am.split(/,\s*/).filter((x) => x !== 'OPTIONS').map((x) => "'" + x + "'").join(', ') + ']');
      if (ah) opts.push('allowedHeaders: [' + ah.split(/,\s*/).map((x) => "'" + x + "'").join(', ') + ']');
      return "// npm install cors\nconst cors = require('cors');\n\nconst corsOptions = {\n  " + opts.join(',\n  ') + ',\n};\n' +
        '// Before your routes and before any auth middleware, so OPTIONS gets a 204:\napp.use(cors(corsOptions));\n' +
        (am ? "app.options('*', cors(corsOptions)); // Express 5: app.options('/{*any}', …)\n" : '');
    }
    if (fmt === 'nginx') {
      const lines = rows.map((r) => '    add_header ' + r.name + ' "' + r.value + '" always;');
      return 'location /api/ {\n' + (am
        ? '    if ($request_method = OPTIONS) {\n' + lines.map((l) => '    ' + l).join('\n') + '\n        add_header Access-Control-Max-Age 600 always;\n        return 204;\n    }\n'
        : '') + lines.join('\n') + '\n    # … your proxy_pass or root\n}';
    }
    if (fmt === 'apache') {
      return '# .htaccess or <VirtualHost>, needs mod_headers (and mod_rewrite for OPTIONS)\n' +
        rows.map((r) => 'Header always set ' + r.name + ' "' + r.value + '"').join('\n') +
        (am ? '\nRewriteEngine On\nRewriteCond %{REQUEST_METHOD} OPTIONS\nRewriteRule ^(.*)$ $1 [R=204,L]' : '');
    }
    return rows.map((r) => r.name + ': ' + r.value).join('\n');
  }

  /** A HeaderDial profile with the rows as response headers, limited to the API host. */
  function buildProfile(rows, host, o) {
    const HD = root.HeaderDial;
    if (!HD || !HD.newProfile) throw new Error('HeaderDial model.js is not loaded');
    const h = String(host || '').trim().toLowerCase();
    const headers = rows.filter((r) => r.name !== 'Vary' && r.value).map((r) => HD.newHeader('response', { name: r.name, value: r.value, op: 'set' }));
    const filters = h ? [HD.newFilter('include', { type: 'domain', value: h })] : [];
    const name = 'CORS fix' + (h ? ' (' + h + ')' : '');
    const i = (o && o.index) || 0;
    return HD.normalizeProfile(HD.newProfile(i, { name, headers, filters }), i);
  }

  const api = { CAUSES, DEFAULT_METHODS, DEFAULT_HEADERS, SIMPLE_METHODS, splitMessages, parseMessage, explain, responseHeaders, snippet, buildProfile, originOf, hostOf, unq };
  root.CorsExplain = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
