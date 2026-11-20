// Cookie explainer: reads the messages Chrome/Edge DevTools and the Firefox console show
// when a cookie is rejected (Set-Cookie) or not sent, plus any Set-Cookie lines, and says
// why, what to change, and how to test it. With the page URL and the cookie's URL it also
// checks a Set-Cookie line on its own (SameSite, Secure, Domain, Path, prefixes, size).
// Message texts: see test/cookie-explain.test.js and test/fixtures/cookie-messages.json.
// Runs in the page and in Node (tests); needs model.js only for buildProfile.
(function (root) {
  'use strict';

  // Each cause. side: 'set' (the browser refused to store it), 'send' (stored, not sent),
  // 'both', or 'info' (works, but worth knowing). serverFix: changing Set-Cookie fixes it.
  const CAUSES = {
    'samesite-none-insecure': {
      title: 'SameSite=None without Secure',
      what: 'A cookie with SameSite=None must also have the Secure attribute, so it can only be used over HTTPS. Without Secure, Chrome, Edge and Firefox refuse to store it (and refuse to send one stored earlier).',
      side: 'both', serverFix: true },
    'samesite-default-lax': {
      title: 'No SameSite attribute, so the browser treats it as SameSite=Lax',
      what: 'The Set-Cookie line has no SameSite attribute. Chrome and Edge then treat the cookie as SameSite=Lax: it is not stored from, and not sent with, a cross-site request such as fetch or XHR to another site, an iframe or an image. Only top-level navigations (clicking a link) carry it across sites. Firefox 158 does not do this yet: it stores the cookie, in a separate jar for the top-level site, so the same code can work in Firefox and fail in Chrome.',
      side: 'both', serverFix: true },
    'samesite-lax': {
      title: 'SameSite=Lax on a cross-site request',
      what: 'SameSite=Lax cookies are only stored from, and sent with, same-site requests and top-level navigations. A fetch, XHR, iframe or image from another site does not get them.',
      side: 'both', serverFix: true },
    'samesite-strict': {
      title: 'SameSite=Strict on a cross-site request',
      what: 'SameSite=Strict cookies are only stored from, and sent with, requests made by the same site. Even clicking a link from another site arrives without them (the next same-site navigation has them).',
      side: 'both', serverFix: true },
    'samesite-cross-site': {
      title: 'SameSite=Lax or Strict in a cross-site context',
      what: 'Firefox rejected the cookie because the response came from another site than the page, and the cookie is SameSite=Lax or Strict. Firefox logs this only when the cookie is set; when a stored Lax or Strict cookie is not sent, it logs nothing.',
      side: 'both', serverFix: true },
    'schemeful': {
      title: 'http and https count as different sites',
      what: 'Chrome compares sites with their scheme: http://example.com and https://example.com are cross-site to each other, so SameSite=Lax or Strict cookies do not cross between them.',
      side: 'both', serverFix: true },
    'samesite-invalid': {
      title: 'SameSite has an invalid value',
      what: 'SameSite must be Strict, Lax or None. Any other value (for example SameSite=false or SameSite=no_restriction) is ignored and the cookie is treated as if it had no SameSite.',
      side: 'info', serverFix: true },
    'secure-insecure': {
      title: 'Secure cookie over plain http',
      what: 'A cookie with the Secure attribute can only be stored by an https response (http://localhost is the exception in current Chrome and Firefox) and is only sent over https.',
      side: 'both', serverFix: false },
    'overwrite-secure': {
      title: 'An http page cannot replace a Secure cookie',
      what: 'There is already a Secure cookie with the same name (set over https). A response over plain http may not overwrite it.',
      side: 'set', serverFix: false },
    'invalid-domain': {
      title: 'The Domain attribute does not match the host',
      what: 'Domain may only name the responding host or one of its parent domains, and never a public suffix such as com, co.uk or github.io. api.example.com may set Domain=example.com, but not Domain=other.com.',
      side: 'set', serverFix: true },
    'domain-mismatch': {
      title: 'The request goes to a host the cookie does not belong to',
      what: 'The cookie was stored for another host. A cookie without Domain belongs to the exact host that set it (api.example.com, not app.example.com). Set Domain=example.com to share it with every subdomain.',
      side: 'send', serverFix: true },
    'path-mismatch': {
      title: 'The request path is outside the cookie\'s Path',
      what: 'A cookie is only sent to its Path and the paths below it. Without a Path attribute, the path defaults to the directory of the URL that set it: a cookie set by /api/auth/login gets Path=/api/auth and is not sent to /api/users. Add Path=/.',
      side: 'send', serverFix: true },
    'invalid-prefix': {
      title: 'The __Host- or __Secure- prefix rules are broken',
      what: 'A name starting with __Secure- needs the Secure attribute (and https). A name starting with __Host- needs Secure, Path=/ and no Domain attribute.',
      side: 'set', serverFix: true },
    'too-large': {
      title: 'The cookie is too large',
      what: 'The name and value together may be at most 4096 bytes. Larger cookies are dropped, not truncated. Store a short session id in the cookie and keep the data on the server, or split it.',
      side: 'set', serverFix: true },
    'attr-too-large': {
      title: 'An attribute value is longer than 1024 bytes',
      what: 'Browsers ignore an attribute (such as Path or Domain) whose value is longer than 1024 bytes; the cookie is stored without it.',
      side: 'info', serverFix: true },
    'partitioned-insecure': {
      title: 'Partitioned without Secure',
      what: 'A Partitioned cookie (CHIPS) must also be Secure. Firefox says so in the console; Chrome 159 drops the cookie without any reason in DevTools.',
      side: 'set', serverFix: true },
    'third-party-blocked': {
      title: 'Third-party cookies are blocked',
      what: 'The cookie belongs to another site than the page in the address bar, and the browser blocks such third-party cookies: Safari always, Chrome in Incognito or when the user turned them off, Firefox with strict settings or for trackers. SameSite=None; Secure is necessary but not enough here.',
      side: 'both', serverFix: false },
    'partitioned-info': {
      title: 'Firefox partitioned the cookie (Total Cookie Protection)',
      what: 'Firefox stores a third-party cookie in a separate jar per top-level site. It works inside this page, but it is a different cookie from the one the API sets when you open it directly, so a login done on the API\'s own site is not seen here.',
      side: 'info', serverFix: false },
    'foreign-no-partitioned': {
      title: 'Firefox warns: a cross-site cookie without Partitioned',
      what: 'The cookie is set in a cross-site (third-party) context and has no Partitioned attribute. Firefox still stores it today (in a jar for this top-level site) but says such cookies will be rejected. If the cookie only has to work while embedded in, or called from, this one site, add Partitioned (it needs Secure). If it has to be shared across sites, plan for third-party cookies going away: serve the API from the same site as the page.',
      side: 'warn', serverFix: true },
    'user-preferences': {
      title: 'Blocked by a browser setting or site permission',
      what: 'The user\'s cookie settings (or a per-site exception) block cookies for this site. No header can change that; it is the user\'s choice.',
      side: 'both', serverFix: false },
    'httponly-script': {
      title: 'JavaScript cannot touch an HttpOnly cookie',
      what: 'document.cookie never shows HttpOnly cookies and cannot overwrite them. The browser still sends them with requests: check the request\'s Cookie header in the Network panel, not document.cookie.',
      side: 'info', serverFix: false },
    'invalid-syntax': {
      title: 'The Set-Cookie line has invalid syntax or characters',
      what: 'Control characters (and, in Chrome, a tab inside the name or value) make the browser drop the whole cookie, and so does a line with no name and no value. Encode the value, for example with encodeURIComponent or base64url.',
      side: 'set', serverFix: true },
    'odd-name': {
      title: 'The cookie name has a space or separator character',
      what: 'Chrome 159 and Firefox 158 store a name such as "a b" (measured), but it is not a valid token in the cookie standard, and server frameworks may not parse it back. Use letters, digits, - and _.',
      side: 'info', serverFix: true },
    'deleted': {
      title: 'The cookie is deleted, not stored',
      what: 'Max-Age=0 (or negative), or an Expires date in the past, tells the browser to delete the cookie. That is how logout works; if you meant to store it, use a future date or Max-Age in seconds.',
      side: 'info', serverFix: true },
    'max-age-capped': {
      title: 'Expiry longer than 400 days is shortened',
      what: 'Chrome and Edge cap cookie lifetime at 400 days; a longer Max-Age or Expires is cut to 400 days.',
      side: 'info', serverFix: true },
    'credentials': {
      title: 'Cross-origin fetch ignores cookies unless credentials are included',
      what: 'For a request to another origin, fetch and XHR do not send cookies, and ignore Set-Cookie in the answer, unless you ask: fetch(url, { credentials: \'include\' }), xhr.withCredentials = true, axios withCredentials: true. The browser logs no cookie warning for this. The API must then answer with Access-Control-Allow-Credentials: true and your exact origin in Access-Control-Allow-Origin.',
      side: 'both', serverFix: false },
    'host-only': {
      title: 'Without Domain, the cookie stays on the host that set it',
      what: 'The cookie is set by one host and your page is on another. It is stored for the setting host only, so the page\'s document.cookie never shows it and requests to the page\'s host do not carry it. That is fine if only the API needs it; add Domain=<parent domain> if both hosts should share it.',
      side: 'info', serverFix: true },
    'unknown': {
      title: 'A cookie message this page does not know yet',
      what: 'Its text is below. The table further down lists the messages it knows.',
      side: 'info', serverFix: null },
  };

  // ---------- message matching ----------

  const Q = '["“”\'`‘’]';
  // Message patterns, most specific first. Each: [id, regex, browser].
  const PATTERNS = [
    // Firefox (necko.properties, dom.properties). The name sits in “…”.
    ['samesite-none-insecure', /rejected because it has the .SameSite=None. attribute but is missing the .secure. attribute/i, 'firefox'],
    ['samesite-none-insecure', /will (?:soon )?be rejected because it has the .SameSite. attribute set to .None. or an invalid value, without the .secure. attribute/i, 'firefox'],
    ['partitioned-insecure', /rejected because it has the .Partitioned. attribute but is missing the .secure. attribute/i, 'firefox'],
    ['samesite-cross-site', /rejected because it is in a cross-site context and its .SameSite. is .Lax. or .Strict./i, 'firefox'],
    ['samesite-default-lax', /.SameSite. policy set to .Lax. because it is missing a .SameSite. attribute/i, 'firefox'],
    ['samesite-default-lax', /does not have a proper .SameSite. attribute value/i, 'firefox'],
    ['samesite-invalid', /Invalid .SameSite. value for cookie/i, 'firefox'],
    ['secure-insecure', /non-HTTPS cookie can.t be set as .secure./i, 'firefox'],
    ['overwrite-secure', /there is an existing .secure. cookie/i, 'firefox'],
    ['invalid-domain', /has been rejected for invalid domain/i, 'firefox'],
    ['invalid-prefix', /has been rejected for invalid prefix/i, 'firefox'],
    ['too-large', /is invalid because its size is too big/i, 'firefox'],
    ['attr-too-large', /is invalid because its path size is too big|attribute .*(?:too big|exceeds)/i, 'firefox'],
    ['invalid-syntax', /has been rejected for invalid characters in the (?:name|value)/i, 'firefox'],
    ['httponly-script', /there is already an HTTP-Only cookie but script tried to store a new one/i, 'firefox'],
    ['third-party-blocked', /has been rejected as third-party|was blocked because (?:it came from a tracker|we are blocking all third-party)/i, 'firefox'],
    ['user-preferences', /rejected by user set permissions|blocked because of custom cookie permission|blocking all storage access requests/i, 'firefox'],
    ['partitioned-info', /Partitioned cookie or storage access was provided to/i, 'firefox'],
    ['foreign-no-partitioned', /will soon be rejected because it is foreign and does not have the .Partitioned. attribute/i, 'firefox'],
    ['deleted', /has been rejected because it is already expired/i, 'firefox'],

    // Chrome / Edge DevTools (Network panel → Cookies, Issues panel).
    ['samesite-none-insecure', /"?SameSite=None"? attribute but (?:did(?: not|n.t) have|was not marked|wasn.t marked) (?:the )?"?Secure"?/i, 'chrome'],
    ['samesite-none-insecure', /Mark cross-site cookies as Secure/i, 'chrome'],
    ['schemeful', /considered cross-site because the URL has a different scheme|Migrate entirely to HTTPS/i, 'chrome'],
    ['samesite-default-lax', /didn.t specify a "?SameSite"? attribute|defaulted to "?SameSite=Lax/i, 'chrome'],
    ['samesite-default-lax', /Indicate whether (?:to send a cookie in a cross-site request|a cookie is intended to be set in a cross-site context) by specifying its SameSite attribute/i, 'chrome'],
    ['samesite-strict', /"?SameSite=Strict"? attribute/i, 'chrome'],
    ['samesite-lax', /"?SameSite=Lax"? attribute/i, 'chrome'],
    ['overwrite-secure', /would have overwritten a cookie with the "?Secure"?/i, 'chrome'],
    ['secure-insecure', /"?Secure"? attribute but (?:was not|wasn.t) received over a secure connection|"?Secure"? attribute and the connection (?:was not|wasn.t) secure|scheme of this connection (?:is not|isn.t) allowed to store cookies/i, 'chrome'],
    ['invalid-domain', /"?Domain"? attribute was invalid with regards to the current host/i, 'chrome'],
    ['domain-mismatch', /neither did the request URL.s domain exactly match the cookie.s domain/i, 'chrome'],
    ['path-mismatch', /its path was not an exact match for or a superdirectory of the request url.s path/i, 'chrome'],
    ['invalid-prefix', /"?__Secure-"? or "?__Host-"? prefix/i, 'chrome'],
    ['too-large', /cookie was too large|name and value must be less than or equal to 4096/i, 'chrome'],
    ['attr-too-large', /attribute value (?:exceeded|exceeds|longer than) .*1024|don.t exceed 1024 characters/i, 'chrome'],
    ['partitioned-insecure', /Partitioned.*(?:Secure|secure)/i, 'chrome'],
    ['third-party-blocked', /third-party cookie|third-party phaseout|Chrome flags or browser configuration|blocked .*tracking protection/i, 'chrome'],
    ['user-preferences', /due to user preferences/i, 'chrome'],
    ['invalid-syntax', /had invalid syntax|contained a disallowed character|had no cookie content/i, 'chrome'],
  ];

  function browserOf(text) {
    if (/“|”|Cookie “|has been rejected|Total Cookie Protection|dynamic state partitioning/.test(text)) return 'firefox';
    if (/This attempt to set a cookie|This cookie was blocked|Set-Cookie` header|This cookie didn|DevTools|Set-Cookie header (?:had|contained|was blocked|didn)/.test(text)) return 'chrome';
    return '';
  }

  /** Split pasted text into separate messages and Set-Cookie lines. */
  function splitInput(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const msgs = [], setCookies = [];
    for (let l of lines) {
      l = l.trim();
      if (!l) continue;
      const m = /^set-cookie\s*:\s*(.*)$/i.exec(l);
      if (m) { if (m[1].trim()) setCookies.push(m[1].trim()); continue; }
      // A bare "name=value; Path=/; ..." line counts as Set-Cookie when it has attributes.
      if (/^[^\s=;"“]{1,200}=[^;]*;\s*(?:path|domain|expires|max-age|secure|httponly|samesite|partitioned)\b/i.test(l) && !/\bcookie\b.*\b(?:blocked|rejected)\b/i.test(l)) { setCookies.push(l); continue; }
      msgs.push(l);
    }
    // Firefox and Chrome messages are one line each; join continuation lines that do not start a new message.
    const joined = [];
    for (const l of msgs) {
      const starts = /^(?:Cookie\s*[“"]|This (?:attempt|cookie|Set-Cookie)|Set-Cookie|Invalid .SameSite|Request to access cookie|Partitioned cookie|Mark |Indicate |Migrate |Ensure |Cookie |⚠|Some cookies|\[)/i.test(l);
      if (!joined.length || starts) joined.push(l); else joined[joined.length - 1] += ' ' + l;
    }
    return { messages: joined, setCookies };
  }

  /** One message → { id, browser, side, name, text }. id 'unknown' when not recognised; null when not about cookies. */
  function parseMessage(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    let id = null, browser = browserOf(t);
    for (const [pid, re, b] of PATTERNS) {
      if (re.test(t)) { id = pid; browser = browser || b; break; }
    }
    if (!id) {
      if (!/cookie|samesite/i.test(t)) return null;
      id = 'unknown';
    }
    // Only Firefox names the cookie: Cookie “name” … (Chrome's tooltips do not).
    // In "rejected as third-party" Firefox puts the whole Set-Cookie value there: keep the name.
    const nm = /(?:^|\s)Cookie\s+“([^”]{1,4200})”/.exec(t) || /cookie\s+“([^”]{1,4200})”/.exec(t);
    let side = 'set';
    if (/This cookie was blocked|This cookie didn.t specify|not sent|to send a cookie|request was made from|have cookies sent/i.test(t)) side = 'send';
    if (id === 'domain-mismatch' || id === 'path-mismatch') side = 'send';
    if (browser === 'firefox' && /will be soon|will soon be|Soon, cookies/i.test(t)) side = 'warn';
    return { id, browser, side, name: nm ? nm[1].split(/[=;]/)[0].trim().slice(0, 200) : '', text: t };
  }

  // ---------- Set-Cookie parsing ----------

  /** Parse one Set-Cookie value (without the "Set-Cookie:" prefix). */
  function parseSetCookie(line) {
    const raw = String(line || '').trim().replace(/^set-cookie\s*:\s*/i, '');
    const parts = raw.split(';');
    const first = parts.shift();
    const eq = first.indexOf('=');
    const out = { raw, name: eq < 0 ? '' : first.slice(0, eq).trim(), value: eq < 0 ? first.trim() : first.slice(eq + 1).trim(), attrs: {}, order: [], unknown: [] };
    for (const p of parts) {
      const i = p.indexOf('=');
      const k = (i < 0 ? p : p.slice(0, i)).trim();
      const v = i < 0 ? '' : p.slice(i + 1).trim();
      if (!k) continue;
      const lk = k.toLowerCase();
      const known = { expires: 'expires', 'max-age': 'maxAge', domain: 'domain', path: 'path', secure: 'secure', httponly: 'httpOnly', samesite: 'sameSite', partitioned: 'partitioned', priority: 'priority' }[lk];
      if (!known) { out.unknown.push(k); continue; }
      out.attrs[known] = (known === 'secure' || known === 'httpOnly' || known === 'partitioned') ? true : v;
      out.order.push({ key: known, name: k, value: v, raw: p.trim() });
    }
    return out;
  }

  // ---------- sites ----------

  // Public suffixes with more than one label that developers hit most. Not the full list
  // (publicsuffix.org); hosts on these are separate sites from each other.
  const SUFFIXES = ['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp', 'co.in', 'co.kr',
    'com.br', 'com.cn', 'com.mx', 'com.tr', 'com.sg', 'com.hk', 'com.tw', 'co.za', 'com.ar', 'com.pl', 'com.ua',
    'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'herokuapp.com', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com',
    'appspot.com', 'azurewebsites.net', 'azurestaticapps.net', 'cloudfront.net', 'onrender.com', 'fly.dev', 'up.railway.app',
    'ngrok.io', 'ngrok-free.app', 'trycloudflare.com', 'glitch.me', 'amplifyapp.com', 'deno.dev', 'blogspot.com'];

  function isIP(h) { return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':'); }
  function publicSuffixOf(host) {
    const h = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!h || isIP(h) || !h.includes('.')) return '';
    let best = h.split('.').slice(-1)[0];
    for (const s of SUFFIXES) if ((h === s || h.endsWith('.' + s)) && s.length > best.length) best = s;
    return best;
  }
  /** Registrable domain ("site" without scheme): example.com for api.example.com; the host itself for IPs and localhost. */
  function siteOf(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!h || isIP(h) || !h.includes('.')) return h;
    if (h === 'localhost' || h.endsWith('.localhost')) return 'localhost';
    const ps = publicSuffixOf(h);
    if (h === ps) return h;
    const rest = h.slice(0, h.length - ps.length - 1).split('.');
    return rest[rest.length - 1] + '.' + ps;
  }
  function parseURL(u) {
    let s = String(u || '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    try { const x = new URL(s); return x.hostname ? x : null; } catch (e) { return null; }
  }
  function isLocal(host) { const h = String(host || '').replace(/^\[|\]$/g, ''); return h === 'localhost' || h.endsWith('.localhost') || /^127\./.test(h) || h === '::1'; }
  function secureURL(u) { return !!u && (u.protocol === 'https:' || u.protocol === 'wss:' || isLocal(u.hostname)); }

  /**
   * The relation between the page (top-level site in the address bar) and the cookie's URL
   * (the response that sets it, or the request that should carry it).
   */
  function context(pageUrl, cookieUrl) {
    const page = parseURL(pageUrl), url = parseURL(cookieUrl);
    const c = { page: page ? page.href : '', url: url ? url.href : '', pageHost: page ? page.hostname : '', host: url ? url.hostname : '', known: !!(page && url) };
    if (url) { c.secure = secureURL(url); c.local = isLocal(url.hostname); c.path = url.pathname; }
    if (page && url) {
      c.pageSite = siteOf(page.hostname); c.site = siteOf(url.hostname);
      c.crossSite = c.pageSite !== c.site;
      c.schemeCross = !c.crossSite && page.protocol !== url.protocol && !(isLocal(page.hostname) && isLocal(url.hostname));
      c.crossOrigin = page.origin !== url.origin;
      c.suffix = publicSuffixOf(url.hostname);
      c.suffixShared = c.crossSite && c.suffix && c.suffix.includes('.') && c.suffix === publicSuffixOf(page.hostname);
    }
    return c;
  }

  function domainMatches(host, domain) {
    const h = String(host || '').toLowerCase(), d = String(domain || '').toLowerCase().replace(/^\./, '');
    return h === d || (h.endsWith('.' + d) && !isIP(h));
  }

  function byteLen(s) { let n = 0; for (const ch of String(s)) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; }

  /**
   * Check a parsed Set-Cookie line, with an optional context from context().
   * Returns [{ id, level: 'blocked'|'warn'|'info', detail }].
   */
  function checkSetCookie(sc, ctx, now) {
    const out = [];
    const add = (id, level, detail) => { if (!out.some((x) => x.id === id)) out.push({ id, level, detail: detail || '' }); };
    const a = sc.attrs, c = ctx || {};
    const ss = a.sameSite != null ? String(a.sameSite).toLowerCase() : null;
    if (!sc.name && !sc.value) add('invalid-syntax', 'blocked', 'There is no name=value pair.');
    if (/[\x00-\x1f\x7f]/.test(sc.name)) add('invalid-syntax', 'blocked', 'The name contains a control character or tab.');
    else if (/[\x00-\x1f\x7f]/.test(sc.value)) add('invalid-syntax', 'blocked', 'The value contains a control character or tab.');
    else if (sc.name && /[\s"(),/:<>?@[\\\]{}]/.test(sc.name)) add('odd-name', 'warn', 'The name "' + sc.name + '" has a space or separator.');
    if (byteLen(sc.name) + byteLen(sc.value) > 4096) add('too-large', 'blocked', 'Name and value are ' + (byteLen(sc.name) + byteLen(sc.value)) + ' bytes.');
    for (const o of sc.order) if (byteLen(o.value) > 1024) add('attr-too-large', 'warn', o.name + ' is ' + byteLen(o.value) + ' bytes.');
    if (ss != null && !['lax', 'strict', 'none'].includes(ss)) add('samesite-invalid', 'warn', 'SameSite=' + a.sameSite + ' is not Strict, Lax or None.');
    if (ss === 'none' && !a.secure) add('samesite-none-insecure', 'blocked');
    if (a.partitioned && !a.secure) add('partitioned-insecure', 'blocked');
    const lname = sc.name.toLowerCase();
    if (lname.startsWith('__secure-') && !a.secure) add('invalid-prefix', 'blocked', '__Secure- needs Secure.');
    if (lname.startsWith('__host-') && (!a.secure || a.domain != null || a.path !== '/')) {
      add('invalid-prefix', 'blocked', '__Host- needs ' + [!a.secure && 'Secure', a.path !== '/' && 'Path=/', a.domain != null && 'no Domain attribute'].filter(Boolean).join(', ') + '.');
    }
    // Expiry.
    const t = now == null ? Date.now() : now;
    if (a.maxAge != null && /^-?\d+$/.test(String(a.maxAge).trim())) {
      const ma = Number(a.maxAge);
      if (ma <= 0) add('deleted', 'info', 'Max-Age=' + a.maxAge + '.');
      else if (ma > 400 * 86400) add('max-age-capped', 'info', 'Max-Age is ' + Math.round(ma / 86400) + ' days.');
    } else if (a.expires) {
      const d = Date.parse(a.expires);
      if (!isNaN(d) && d <= t) add('deleted', 'info', 'Expires is in the past (' + a.expires + ').');
      else if (!isNaN(d) && d - t > 400 * 86400e3) add('max-age-capped', 'info', 'Expires is ' + Math.round((d - t) / 86400e3) + ' days away.');
    }
    if (a.httpOnly) add('httponly-script', 'info');
    // Needs the cookie's URL.
    if (c.host) {
      if (a.secure && !c.secure) add('secure-insecure', 'blocked', c.host + ' is served over http.');
      if (a.domain != null && a.domain !== '') {
        const d = String(a.domain).toLowerCase().replace(/^\./, '');
        if (!domainMatches(c.host, d)) add('invalid-domain', 'blocked', 'Domain=' + a.domain + ' does not cover ' + c.host + '.');
        else if (d === publicSuffixOf(c.host) || (!d.includes('.') && d !== c.host)) add('invalid-domain', 'blocked', a.domain + ' is a public suffix.');
      }
      if (a.path == null || !String(a.path).startsWith('/')) {
        const dir = (c.path || '/').replace(/\/[^/]*$/, '') || '/';
        if (dir !== '/') add('path-mismatch', 'warn', 'With no Path, this cookie gets Path=' + dir + ' and is only sent to URLs under ' + dir + '/.');
      }
    }
    // Needs the page too.
    if (c.known) {
      if (c.crossSite) {
        if (ss == null || !['lax', 'strict', 'none'].includes(ss)) add('samesite-default-lax', 'blocked', 'The page (' + c.pageSite + ') and ' + c.host + ' (' + c.site + ') are different sites.');
        else if (ss === 'lax') add('samesite-lax', 'blocked', 'The page (' + c.pageSite + ') and ' + c.host + ' (' + c.site + ') are different sites.');
        else if (ss === 'strict') add('samesite-strict', 'blocked', 'The page (' + c.pageSite + ') and ' + c.host + ' (' + c.site + ') are different sites.');
        else if (a.secure && c.secure) add('third-party-blocked', 'warn', c.host + ' is a third party on ' + c.pageHost + '.');
        if (a.secure && c.secure && ss === 'none') add('partitioned-info', 'info');
      } else if (c.schemeCross && ss !== 'none') add('schemeful', 'blocked', 'The page and the cookie URL differ in scheme (http vs https).');
      if (c.crossOrigin) add('credentials', 'warn', 'The page (' + new URL(c.page).origin + ') and the cookie URL (' + new URL(c.url).origin + ') are different origins.');
      if (c.pageHost !== c.host && (a.domain == null || a.domain === '') && !out.some((x) => x.level === 'blocked')) add('host-only', 'info');
    }
    return out;
  }

  /**
   * A corrected Set-Cookie line. o: { crossSite (the cookie must work cross-site),
   * partitioned, ctx }. Returns { line, changes: [text] }.
   */
  function fixSetCookie(sc, o) {
    o = o || {};
    const c = o.ctx || {};
    const a = Object.assign({}, sc.attrs);
    const changes = [];
    const lname = sc.name.toLowerCase();
    const ss = a.sameSite != null ? String(a.sameSite).toLowerCase() : null;
    if (o.crossSite) {
      if (ss !== 'none') { a.sameSite = 'None'; changes.push('SameSite=None so it works in a cross-site context'); }
      if (!a.secure) { a.secure = true; changes.push('Secure (required by SameSite=None; needs https)'); }
      if (o.partitioned && !a.partitioned) { a.partitioned = true; changes.push('Partitioned, so it also works where third-party cookies are blocked (one cookie per top-level site)'); }
    } else if (ss != null && !['lax', 'strict', 'none'].includes(ss)) { a.sameSite = 'Lax'; changes.push('SameSite=Lax (the invalid value was ignored anyway)'); }
    else if (ss === 'none' && !a.secure) { a.secure = true; changes.push('Secure (required by SameSite=None; needs https)'); }
    if (a.partitioned && !a.secure) { a.secure = true; changes.push('Secure (required by Partitioned)'); }
    if (lname.startsWith('__secure-') && !a.secure) { a.secure = true; changes.push('Secure (required by the __Secure- prefix)'); }
    if (lname.startsWith('__host-')) {
      if (!a.secure) { a.secure = true; changes.push('Secure (required by __Host-)'); }
      if (a.path !== '/') { a.path = '/'; changes.push('Path=/ (required by __Host-)'); }
      if (a.domain != null) { delete a.domain; changes.push('removed Domain (not allowed with __Host-)'); }
    }
    if (c.host && a.domain != null && a.domain !== '') {
      const d = String(a.domain).toLowerCase().replace(/^\./, '');
      if (!domainMatches(c.host, d) || d === publicSuffixOf(c.host) || !d.includes('.')) {
        delete a.domain; changes.push('removed Domain=' + sc.attrs.domain + ' (it does not cover ' + c.host + '; the cookie now belongs to ' + c.host + ' only)');
      }
    }
    if (a.path == null || !String(a.path).startsWith('/')) {
      const dir = c.path ? (c.path.replace(/\/[^/]*$/, '') || '/') : '/';
      if (dir !== '/' || a.path != null || !c.path) changes.push('Path=/ so it is sent to every path on the host');
      a.path = '/';
    }
    const parts = [sc.name + '=' + sc.value];
    const fmt = (k) => {
      if (k === 'secure') return a.secure ? 'Secure' : '';
      if (k === 'httpOnly') return a.httpOnly ? 'HttpOnly' : '';
      if (k === 'partitioned') return a.partitioned ? 'Partitioned' : '';
      if (a[k] == null) return '';
      const label = { expires: 'Expires', maxAge: 'Max-Age', domain: 'Domain', path: 'Path', sameSite: 'SameSite', priority: 'Priority' }[k];
      let v = String(a[k]);
      if (k === 'sameSite') v = { lax: 'Lax', strict: 'Strict', none: 'None' }[v.toLowerCase()] || v;
      return label + '=' + v;
    };
    for (const k of ['expires', 'maxAge', 'domain', 'path', 'secure', 'httpOnly', 'sameSite', 'partitioned', 'priority']) {
      const s = fmt(k); if (s) parts.push(s);
    }
    return { line: parts.join('; '), attrs: a, changes };
  }

  // ---------- explain ----------

  /**
   * Explain pasted text. o: { page, url, now }. Returns { messages, setCookies: [{ sc, issues }],
   * causes: [{ id, level, from: 'message'|'check', detail, name, text }], ctx, browser }.
   */
  function explain(text, o) {
    o = o || {};
    const { messages: raw, setCookies: lines } = splitInput(text);
    const messages = raw.map(parseMessage).filter(Boolean);
    const ctx = context(o.page, o.url);
    const setCookies = lines.map((l) => { const sc = parseSetCookie(l); return { sc, issues: checkSetCookie(sc, ctx, o.now) }; });
    const causes = [];
    const seen = {};
    for (const m of messages) {
      const k = m.id + '|' + m.name;
      if (seen[k]) continue; seen[k] = 1;
      causes.push({ id: m.id, level: m.side === 'warn' ? 'warn' : (CAUSES[m.id] && CAUSES[m.id].side === 'info') ? 'info' : 'blocked', from: 'message', side: m.side, name: m.name, text: m.text, browser: m.browser });
    }
    for (const s of setCookies) for (const i of s.issues) {
      // A message without a cookie name (Chrome's) and a check of the pasted line are one cause.
      const same = causes.find((c) => c.id === i.id && (c.name === s.sc.name || !c.name));
      if (same) { same.name = same.name || s.sc.name; if (i.detail && !same.detail) same.detail = i.detail; continue; }
      causes.push({ id: i.id, level: i.level, from: 'check', name: s.sc.name, detail: i.detail });
    }
    const rank = { blocked: 0, warn: 1, info: 2 };
    causes.sort((x, y) => rank[x.level] - rank[y.level]);
    const browsers = [...new Set(messages.map((m) => m.browser).filter(Boolean))];
    const names = [...new Set(messages.map((m) => m.name).concat(setCookies.map((s) => s.sc.name)).filter(Boolean))];
    // Does the cookie need to work cross-site? Known from the context, or implied by the cause.
    const crossIds = ['samesite-none-insecure', 'samesite-default-lax', 'samesite-lax', 'samesite-strict', 'samesite-cross-site', 'schemeful', 'third-party-blocked', 'partitioned-info'];
    const crossSite = ctx.known ? !!(ctx.crossSite || ctx.schemeCross) : causes.some((c) => crossIds.includes(c.id) && c.level !== 'info');
    return { messages, setCookies, causes, ctx, browser: browsers.length === 1 ? browsers[0] : browsers.length ? 'mixed' : '', names, crossSite };
  }

  // ---------- output ----------

  function jsStr(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
  function phpStr(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }

  /** Server code for a fixed cookie. fmt: 'header' | 'express' | 'php' | 'django' | 'nginx'. */
  function snippet(name, value, a, fmt) {
    a = a || {};
    const ss = a.sameSite ? ({ lax: 'Lax', strict: 'Strict', none: 'None' }[String(a.sameSite).toLowerCase()] || a.sameSite) : '';
    const maxAgeS = a.maxAge != null && /^-?\d+$/.test(String(a.maxAge)) ? Number(a.maxAge) : null;
    if (fmt === 'express') {
      const opts = [];
      if (a.httpOnly) opts.push('httpOnly: true');
      if (a.secure) opts.push('secure: true');
      if (ss) opts.push("sameSite: '" + ss.toLowerCase() + "'");
      if (a.partitioned) opts.push('partitioned: true');
      if (a.domain) opts.push('domain: ' + jsStr(a.domain));
      if (a.path) opts.push('path: ' + jsStr(a.path));
      if (maxAgeS != null) opts.push('maxAge: ' + maxAgeS * 1000);
      else if (a.expires) opts.push('expires: new Date(' + jsStr(a.expires) + ')');
      return 'res.cookie(' + jsStr(name) + ', ' + jsStr(value) + ', {\n  ' + opts.join(',\n  ') + ',\n});\n' +
        (maxAgeS != null ? '// Express takes maxAge in milliseconds (the header says seconds).\n' : '') + '\n' +
        '// express-session: the same options go in session({ cookie: { … } }).\n' +
        (a.secure ? "// Behind a proxy or load balancer that ends TLS, also: app.set('trust proxy', 1);\n// otherwise Express thinks the request is http and drops the Secure cookie.\n" : '');
    }
    if (fmt === 'php') {
      const opts = [];
      if (maxAgeS != null) opts.push("'expires' => time() + " + maxAgeS);
      else if (a.expires) opts.push("'expires' => strtotime(" + phpStr(a.expires) + ')');
      if (a.path) opts.push("'path' => " + phpStr(a.path));
      if (a.domain) opts.push("'domain' => " + phpStr(a.domain));
      if (a.secure) opts.push("'secure' => true");
      if (a.httpOnly) opts.push("'httponly' => true");
      if (ss) opts.push("'samesite' => '" + ss + "'");
      return '// PHP 7.3 or later\nsetcookie(' + phpStr(name) + ', ' + phpStr(value) + ', [\n    ' + opts.join(',\n    ') + ',\n]);' +
        (a.partitioned ? "\n// setcookie() has no Partitioned option before PHP 8.5; send the line yourself:\n// header('Set-Cookie: " + String(name).replace(/'/g, '') + "=…; " + ['Path=/', 'Secure', 'SameSite=None', 'Partitioned'].join('; ') + "', false);" : '') +
        "\n\n// Sessions: session_set_cookie_params([...same keys...]) before session_start(),\n// or session.cookie_samesite / session.cookie_secure in php.ini.";
    }
    if (fmt === 'django') {
      const opts = [];
      if (maxAgeS != null) opts.push('max_age=' + maxAgeS);
      else if (a.expires) opts.push('expires=' + JSON.stringify(a.expires));
      if (a.path) opts.push('path=' + JSON.stringify(a.path));
      if (a.domain) opts.push('domain=' + JSON.stringify(a.domain));
      if (a.secure) opts.push('secure=True');
      if (a.httpOnly) opts.push('httponly=True');
      if (ss) opts.push('samesite=' + JSON.stringify(ss));
      return 'response.set_cookie(\n    ' + [JSON.stringify(name), JSON.stringify(value)].concat(opts).join(',\n    ') + ',\n)\n\n' +
        '# Django\'s own session and CSRF cookies, in settings.py:\n' +
        (ss ? '# SESSION_COOKIE_SAMESITE = ' + JSON.stringify(ss) + '\n# CSRF_COOKIE_SAMESITE = ' + JSON.stringify(ss) + '\n' : '') +
        (a.secure ? '# SESSION_COOKIE_SECURE = True\n# CSRF_COOKIE_SECURE = True\n' : '') +
        (a.partitioned ? '# Partitioned is not a set_cookie() option; add it to the header yourself.\n' : '');
    }
    if (fmt === 'nginx') {
      const flags = [a.secure && 'secure', a.httpOnly && 'httponly', ss && 'samesite=' + ss.toLowerCase()].filter(Boolean);
      return '# When nginx proxies the app, rewrite the attributes of the app\'s cookie (nginx 1.19.3+):\nlocation / {\n    proxy_pass http://app;\n' +
        (flags.length ? '    proxy_cookie_flags ' + name + ' ' + flags.join(' ') + ';\n' : '') +
        (a.path === '/' ? '    proxy_cookie_path ~^/.+$ /;   # if the app sets a deeper Path\n' : '') +
        '}' + (a.partitioned ? '\n# proxy_cookie_flags cannot add Partitioned; set it in the app.' : '');
    }
    const parts = [name + '=' + value];
    if (a.expires) parts.push('Expires=' + a.expires);
    if (a.maxAge != null) parts.push('Max-Age=' + a.maxAge);
    if (a.domain) parts.push('Domain=' + a.domain);
    if (a.path) parts.push('Path=' + a.path);
    if (a.secure) parts.push('Secure');
    if (a.httpOnly) parts.push('HttpOnly');
    if (ss) parts.push('SameSite=' + ss);
    if (a.partitioned) parts.push('Partitioned');
    return 'Set-Cookie: ' + parts.join('; ');
  }

  /**
   * A HeaderDial profile that stores the fixed cookie on the host's responses (a "Store"
   * cookie row), and optionally sends name=value on its requests ("Send" row).
   * o: { name, value, attrs (string after name=value), host, send, index }.
   */
  function buildProfile(o) {
    const HD = root.HeaderDial;
    if (!HD || !HD.newProfile) throw new Error('HeaderDial model.js is not loaded');
    o = o || {};
    const h = String(o.host || '').trim().toLowerCase();
    const cookies = [HD.newCookie('response', { name: o.name, value: o.value || '', attrs: o.attrs || '' })];
    if (o.send) cookies.push(HD.newCookie('request', { name: o.name, value: o.value || '' }));
    const filters = h ? [HD.newFilter('include', { type: 'domain', value: h })] : [];
    const i = o.index || 0;
    return HD.normalizeProfile(HD.newProfile(i, { name: 'Cookie fix' + (h ? ' (' + h + ')' : ''), headers: [], cookies, filters }), i);
  }

  const api = { CAUSES, PATTERNS, splitInput, parseMessage, parseSetCookie, siteOf, publicSuffixOf, context, checkSetCookie, fixSetCookie, explain, snippet, buildProfile, domainMatches };
  root.CookieExplain = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
