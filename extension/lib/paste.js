// Turn a copied request into a profile: a curl command (DevTools "Copy as cURL" in bash
// or Windows cmd form, Postman, or hand-written), DevTools "Copy as fetch", raw header
// lines ("Name: value", as DevTools and HTTP/1.1 show them), or a JSON object of headers.
// Headers the browser already sends on its own (Accept, Sec-Fetch-*, its cookies, ...)
// come back unticked when the text was copied from a browser, so importing a DevTools
// copy keeps the Authorization and X-* headers and does not freeze everything else.
(function (root) {
  'use strict';
  const HD = root.HeaderDial || (typeof require === 'function' ? require('./transfer.js') : null);
  const NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

  // Browsers set these themselves, refuse to let extensions change them, or they only
  // make sense for one specific request.
  const BROWSER_ONLY = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'te',
    'upgrade', 'expect', 'trailer', 'priority', 'accept-encoding', 'proxy-connection', 'http2-settings']);
  // Sent by every browser request; overriding them for all requests is rarely what you want.
  const BROWSER_DEFAULT = new Set(['accept', 'accept-language', 'user-agent', 'referer', 'origin', 'cache-control',
    'pragma', 'upgrade-insecure-requests', 'dnt', 'content-type', 'if-none-match', 'if-modified-since', 'range',
    'x-requested-with', 'purpose', 'sec-gpc', 'service-worker-navigation-preload']);

  // curl options that take a value (the value is skipped unless handled below).
  const CURL_ARG = new Set(['-o', '--output', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '-U', '--proxy-user',
    '--cacert', '--capath', '-E', '--cert', '--key', '--cert-type', '--key-type', '-w', '--write-out', '--retry',
    '--retry-delay', '--retry-max-time', '-T', '--upload-file', '--resolve', '--connect-to', '-r', '--range', '-z',
    '--time-cond', '-c', '--cookie-jar', '-D', '--dump-header', '--interface', '--limit-rate', '-Y', '--speed-limit',
    '-y', '--speed-time', '--max-redirs', '--max-filesize', '-K', '--config', '--trace', '--trace-ascii', '--stderr',
    '--unix-socket', '--abstract-unix-socket', '--dns-servers', '--local-port', '-Q', '--quote', '--request-target',
    '--data-urlencode', '--data-binary', '--data-raw', '--data-ascii', '-d', '--data', '--json', '-F', '--form',
    '--form-string', '-X', '--request', '-t', '--telnet-option', '--proxy-header', '--aws-sigv4', '--variable',
    '--url-query', '--expand-url', '--expand-data', '--expand-header', '--etag-save', '--etag-compare', '--happy-eyeballs-timeout-ms',
    '--keepalive-time', '--ciphers', '--tls-max', '--pinnedpubkey', '--noproxy', '--preproxy', '--sasl-authzid', '--service-name']);
  const BODY = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '--json', '-F', '--form',
    '--form-string', '-T', '--upload-file']);

  // POSIX shell words of the first command in the text. Handles '...', "...", $'...',
  // backslash escapes and line continuations, and # comments.
  function bashWords(text) {
    const words = [];
    let cur = null, i = 0;
    const s = text;
    const push = () => { if (cur !== null) words.push(cur); cur = null; };
    while (i < s.length) {
      const c = s[i];
      if (c === '\\' && s[i + 1] === '\n') { i += 2; continue; }
      if (c === '\\' && s[i + 1] === '\r' && s[i + 2] === '\n') { i += 3; continue; }
      if (c === '\n' || c === ';' || c === '|' || c === '&') {
        if (words.length || cur !== null) { push(); if (words.length) break; }
        i++; continue;
      }
      if (c === ' ' || c === '\t' || c === '\r') { push(); i++; continue; }
      if (c === '#' && cur === null) { while (i < s.length && s[i] !== '\n') i++; continue; }
      cur = cur || '';
      if (c === "'") {
        const j = s.indexOf("'", i + 1);
        if (j < 0) throw new Error('Unclosed \' quote in the curl command.');
        cur += s.slice(i + 1, j); i = j + 1;
      } else if (c === '$' && s[i + 1] === "'") {
        i += 2;
        while (i < s.length && s[i] !== "'") {
          if (s[i] !== '\\') { cur += s[i++]; continue; }
          const n = s[i + 1];
          const simple = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v', '?': '?' };
          let m;
          if (n in simple) { cur += simple[n]; i += 2; } else if ((m = /^x([0-9a-fA-F]{1,2})/.exec(s.slice(i + 1)))) {
            cur += String.fromCharCode(parseInt(m[1], 16)); i += 1 + m[0].length;
          } else if ((m = /^u([0-9a-fA-F]{1,4})/.exec(s.slice(i + 1))) || (m = /^U([0-9a-fA-F]{1,8})/.exec(s.slice(i + 1)))) {
            cur += String.fromCodePoint(parseInt(m[1], 16)); i += 1 + m[0].length;
          } else if ((m = /^[0-7]{1,3}/.exec(s.slice(i + 1)))) {
            cur += String.fromCharCode(parseInt(m[0], 8)); i += 1 + m[0].length;
          } else { cur += '\\' + (n || ''); i += 2; }
        }
        if (i >= s.length) throw new Error('Unclosed $\' quote in the curl command.');
        i++;
      } else if (c === '"') {
        i++;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === '\\' && '"\\$`\n'.includes(s[i + 1])) { if (s[i + 1] !== '\n') cur += s[i + 1]; i += 2; } else cur += s[i++];
        }
        if (i >= s.length) throw new Error('Unclosed " quote in the curl command.');
        i++;
      } else if (c === '\\') {
        cur += s[i + 1] || ''; i += 2;
      } else { cur += c; i++; }
    }
    push();
    return words;
  }

  // Windows cmd ("Copy as cURL (cmd)"): ^ escapes for cmd itself, then the program's
  // own argument rules: "..." groups words and \" is a literal quote.
  function cmdWords(text) {
    let s = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '^') {
        if (text[i + 1] === '\r' && text[i + 2] === '\n') { i += 2; continue; }
        if (text[i + 1] === '\n') { i++; continue; }
        s += text[++i] || '';
      } else s += text[i];
    }
    // Then the Windows argument rules: 2n backslashes before a quote are n backslashes and
    // the quote delimits; 2n+1 are n and a literal quote; "" inside quotes is a literal quote
    // (newer Chrome writes that); other backslashes are literal.
    const words = [];
    let cur = null, quoted = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') {
        let j = i;
        while (s[j] === '\\') j++;
        const n = j - i;
        if (s[j] !== '"') { cur = (cur || '') + s.slice(i, j); i = j - 1; continue; }
        cur = (cur || '') + '\\'.repeat(Math.floor(n / 2));
        if (n % 2) { cur += '"'; i = j; continue; }
        i = j - 1; continue;
      }
      if (c === '"' && quoted && s[i + 1] === '"') { cur += '"'; i++; continue; }
      if (c === '"') { cur = cur || ''; quoted = !quoted; continue; }
      if (!quoted && /\s/.test(c)) {
        if (cur !== null) { words.push(cur); cur = null; }
        continue;
      }
      cur = (cur || '') + c;
    }
    if (cur !== null) words.push(cur);
    return words;
  }

  const isCmd = (t) => /\^"/.test(t) || /\s\^\r?\n/.test(t);

  function header(name, value, why) {
    return { kind: 'header', name: name.trim(), value, remove: false, keep: true, why: why || '' };
  }

  function splitHeaderLine(line) {
    const i = line.indexOf(':');
    if (i <= 0) return null;
    const name = line.slice(0, i).trim();
    if (!NAME_RE.test(name)) return null;
    return { name, value: line.slice(i + 1).trim() };
  }

  function parseCurl(text) {
    const words = isCmd(text) ? cmdWords(text) : bashWords(text);
    if (!words.length || !/^curl(\.exe)?$/i.test(words[0])) return null;
    const out = { source: 'curl', url: '', method: '', items: [], notes: [] };
    const skipped = new Set();
    for (let i = 1; i < words.length; i++) {
      let w = words[i];
      let val = null;
      const eq = /^(--[a-z0-9-]+)=(.*)$/s.exec(w);
      if (eq) { w = eq[1]; val = eq[2]; }
      const next = () => (val !== null ? val : words[++i] !== undefined ? words[i] : '');
      // Short options can be glued together (-sSL) or to their value (-HX-A:\ 1).
      if (/^-[a-zA-Z0-9]{2,}$/.test(w) && !CURL_ARG.has(w)) {
        const letters = w.slice(1);
        let used = false;
        for (let k = 0; k < letters.length; k++) {
          const f = '-' + letters[k];
          if (CURL_ARG.has(f) || ['-H', '-b', '-A', '-e', '-u'].includes(f)) {
            val = letters.slice(k + 1) || null;
            w = f; used = true; break;
          }
          if (f === '-I') out.method = 'HEAD';
        }
        if (!used) continue;
      }
      switch (w) {
        case '-H': case '--header': {
          const h = next();
          const m = /^([^:;]+)([:;])(.*)$/s.exec(h);
          if (!m) { out.notes.push(`Skipped header "${h}" (not "Name: value").`); break; }
          const name = m[1].trim();
          if (m[2] === ';') { out.items.push(header(name, '')); break; }
          const value = m[3].trim();
          if (value === '') { const it = header(name, ''); it.remove = true; out.items.push(it); } else out.items.push(header(name, value));
          break;
        }
        case '-A': case '--user-agent': out.items.push(header('User-Agent', next())); break;
        case '-e': case '--referer': out.items.push(header('Referer', next().replace(/;auto$/, ''))); break;
        case '-b': case '--cookie': {
          const c = next();
          if (!c.includes('=')) { out.notes.push(`Skipped -b ${c}: that reads cookies from a file.`); break; }
          out.items.push(header('Cookie', c));
          break;
        }
        case '-u': case '--user': {
          const u = next();
          out.items.push(header('Authorization', 'Basic ' + HD.b64Text(u.includes(':') ? u : u + ':'), 'from -u'));
          break;
        }
        case '--oauth2-bearer': out.items.push(header('Authorization', 'Bearer ' + next(), 'from --oauth2-bearer')); break;
        case '--url': out.url = out.url || next(); break;
        case '-X': case '--request': out.method = next().toUpperCase(); break;
        case '-G': case '--get': out.method = 'GET'; break;
        case '-I': case '--head': out.method = 'HEAD'; break;
        default:
          if (CURL_ARG.has(w)) {
            next();
            if (BODY.has(w)) skipped.add('body');
            if (w === '--json') { out.method = out.method || 'POST'; }
          } else if (w.startsWith('-') && w.length > 1) {
            // a flag without a value (-s, -L, -k, --compressed, ...)
          } else if (!out.url) out.url = w;
      }
    }
    // Firefox's POSIX "Copy as cURL" also writes & and | inside quotes as ^& and ^| (a
    // Windows escape it applies on every platform). Its copies are the ones with Title-Case
    // Sec-Fetch-* names; Chrome writes them in lower case.
    if (!isCmd(text) && out.items.some((h) => /^Sec-Fetch-/.test(h.name))) {
      for (const h of out.items) h.value = h.value.replace(/\^([&|])/g, '$1');
      out.url = out.url.replace(/\^([&|])/g, '$1');
    }
    if (skipped.has('body') && !out.method) out.method = 'POST';
    // curl reads [] and {} in URLs as globs; DevTools escapes them with a backslash.
    out.url = out.url.replace(/\\([[\]{}])/g, '$1');
    if (skipped.has('body')) out.notes.push('The request body was left out: a profile changes headers on requests your pages make, it does not send its own.');
    return out;
  }

  // fetch("url", {...}) as copied by Chrome or Firefox DevTools ("Copy as fetch").
  function parseFetch(text) {
    const m = /^\s*(?:await\s+)?fetch\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*(?:,\s*(\{[\s\S]*\}))?\s*\)\s*;?\s*$/.exec(text);
    if (!m) return null;
    let url, opts;
    try {
      url = m[1][0] === '"' ? JSON.parse(m[1]) : m[1].slice(1, -1);
      opts = m[2] ? JSON.parse(m[2]) : {};
    } catch (e) {
      throw new Error('This looks like a fetch() call, but its options are not plain JSON: ' + e.message);
    }
    const out = { source: 'fetch', url, method: String(opts.method || 'GET').toUpperCase(), items: [], notes: [] };
    const hs = opts.headers && typeof opts.headers === 'object' ? opts.headers : {};
    for (const [k, v] of Object.entries(hs)) out.items.push(header(k, String(v)));
    if (opts.referrer && typeof opts.referrer === 'string') out.referrer = opts.referrer;
    if (opts.body != null) out.notes.push('The request body was left out: a profile changes headers on requests your pages make, it does not send its own.');
    // DevTools adds mode and credentials; a hand-written fetch rarely has both.
    // "body": null is also a DevTools tell (Chrome writes it for every GET, Node.js variant included).
    out.fromBrowser = ('mode' in opts && 'credentials' in opts) || opts.body === null;
    return out;
  }

  // Raw header lines, optionally with a request line ("GET /x HTTP/1.1") and HTTP/2
  // pseudo-headers (":authority: example.com"), as DevTools shows them.
  function parseRaw(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return null;
    const out = { source: 'headers', url: '', method: '', items: [], notes: [] };
    const pseudo = {};
    let path = '';
    for (const [i, line] of lines.entries()) {
      let m;
      if (i === 0 && (m = /^([A-Z]+)\s+(\S+)\s+HTTP\/[\d.]+$/.exec(line))) { out.method = m[1]; path = m[2]; continue; }
      if ((m = /^:([a-z]+):\s*(.*)$/.exec(line))) { pseudo[m[1]] = m[2]; continue; }
      const h = splitHeaderLine(line);
      if (!h) return null;
      out.items.push(header(h.name, h.value));
    }
    if (!out.items.length) return null;
    const host = pseudo.authority || (out.items.find((h) => h.name.toLowerCase() === 'host') || {}).value;
    path = pseudo.path || path;
    if (host) out.url = (pseudo.scheme || 'https') + '://' + host + (path.startsWith('/') ? path : '/');
    if (pseudo.method) out.method = pseudo.method;
    return out;
  }

  // {"Authorization": "Bearer x", "X-Env": "staging"}: what axios, Postman scripts and
  // many docs show. Only accepted when every key is a header name and every value a string.
  function parseHeaderObject(text) {
    if (!/^\s*\{/.test(text)) return null;
    let o;
    try { o = JSON.parse(text); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const src = o.headers && typeof o.headers === 'object' && !Array.isArray(o.headers) ? o.headers : o;
    const entries = Object.entries(src);
    if (!entries.length || !entries.every(([k, v]) => NAME_RE.test(k) && (typeof v === 'string' || typeof v === 'number'))) return null;
    return { source: 'JSON headers', url: '', method: '', items: entries.map(([k, v]) => header(k, String(v))), notes: [] };
  }

  function hostOf(url) {
    try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname : ''; } catch (e) { return ''; }
  }

  /**
   * Recognise a copied request. Returns null when the text is not one, otherwise
   * { source, url, host, method, items: [{ kind, name, value, remove, keep, why }], notes }.
   * keep is the suggested tick; why says why an item is unticked.
   */
  function parseRequestText(text) {
    // Comment lines first (HeaderDial's own "Copy as curl…" starts with some), then a "$ " prompt.
    let t = String(text || '').trim().replace(/^(?:#[^\n]*\n\s*)+/, '').replace(/^\$\s+(?=curl\b)/, '');
    if (!t) return null;
    let req = null;
    if (/^curl(\.exe)?\s/i.test(t)) req = parseCurl(t);
    else if (/^(await\s+)?fetch\s*\(/.test(t)) req = parseFetch(t);
    else req = parseHeaderObject(t) || parseRaw(t);
    if (!req) return null;
    // A copy from a browser carries the browser's own headers; those stay unticked.
    const names = req.items.map((h) => h.name.toLowerCase());
    const fromBrowser = req.fromBrowser || names.some((n) => n.startsWith('sec-fetch-') || n.startsWith('sec-ch-ua'));
    const items = [];
    const seen = new Map();
    for (const h of req.items) {
      const n = h.name.toLowerCase();
      if (n === 'cookie' && !h.remove) {
        for (const part of h.value.split(';')) {
          const eq = part.indexOf('=');
          if (eq <= 0) continue;
          items.push({ kind: 'cookie', name: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim(), remove: false,
            keep: !fromBrowser, why: fromBrowser ? 'your browser already sends its own cookies for this site' : '' });
        }
        continue;
      }
      if (BROWSER_ONLY.has(n) || n.startsWith('sec-fetch-') || n.startsWith('sec-ch-') || n.startsWith(':') || n.startsWith('proxy-')) {
        h.keep = false; h.why = 'the browser sets this itself';
      } else if (n === 'content-type' || n === 'if-none-match' || n === 'if-modified-since' || n === 'range') {
        h.keep = false; h.why = 'belongs to that one request, not to every request';
      } else if (fromBrowser && BROWSER_DEFAULT.has(n)) {
        h.keep = false; h.why = 'your browser already sends this';
      }
      if (seen.has(n) && !h.remove) seen.get(n).keep = false;
      seen.set(n, h);
      items.push(h);
    }
    const host = hostOf(req.url);
    return { source: req.source, url: req.url, host, method: req.method, fromBrowser, items, notes: req.notes };
  }

  /**
   * Build a profile from a parsed request and the user's ticks. onlyHost adds a Domain
   * filter for the request's host (subdomains included), so the headers do not leak to
   * every site.
   */
  function profileFromRequest(req, opts) {
    const o = Object.assign({ onlyHost: !!req.host, index: 0 }, opts);
    const kept = req.items.filter((it) => it.keep);
    const headers = kept.filter((it) => it.kind === 'header').map((it) => HD.newHeader('request', {
      name: it.name, value: it.remove ? '' : it.value, op: it.remove ? 'remove' : 'set' }));
    const cookies = kept.filter((it) => it.kind === 'cookie').map((it) => HD.newCookie('request', { name: it.name, value: it.value }));
    const filters = o.onlyHost && req.host ? [HD.newFilter('include', { type: 'domain', value: req.host })] : [];
    const label = req.source === 'curl' ? 'curl' : req.source === 'fetch' ? 'fetch' : 'pasted headers';
    const name = (req.host ? req.host + ' ' : '') + '(' + label + ')';
    return HD.normalizeProfile(HD.newProfile(o.index, { name, headers, cookies, filters }), o.index);
  }

  function b64Text(t) {
    const bytes = new TextEncoder().encode(t);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  Object.assign(HD, { parseRequestText, profileFromRequest, b64Text, _pasteWords: { bashWords, cmdWords } });
  if (typeof module !== 'undefined' && module.exports) module.exports = HD;
})(typeof self !== 'undefined' ? self : globalThis);
