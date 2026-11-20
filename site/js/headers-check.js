// Security headers checker for site/guides/security-headers-checker.html. Reads pasted
// response headers (DevTools raw or list view, Firefox "Copy All" JSON, curl -I / -D - /
// -v output), gives each security-relevant header a verdict, suggests header values to
// try, and builds a HeaderDial profile of response-header rows from them.
// No browser APIs at load time, so `node --test` can require it. Building a profile needs
// window.HeaderDial (extension/lib/model.js), loaded before it.
(function (root) {
  'use strict';
  const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
  const STATUS_LINE = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\b\s*(.*)$/i;
  const REQUEST_LINE = /^[A-Z]+\s+\S+\s+HTTP\/[\d.]+$/;
  // Labels of Chrome's "General" section (and the same in other tools), with the value
  // either after a colon or on the next line.
  const GENERAL = /^(request url|request method|status code|remote address|referrer policy)\s*:?\s*(.*)$/i;
  const HEADING = /^(response headers|request headers|general|headers)(\s*\(.*\))?\s*:?$/i;
  const HALF_YEAR = 15552000; // 180 days, in seconds
  const YEAR = 31536000;

  const lc = (s) => String(s).toLowerCase();

  // ---------------------------------------------------------------- parsing

  function fromJSON(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    const found = []; // [{ key, headers }]
    (function walk(o, key) {
      if (Array.isArray(o)) {
        if (o.length && o.every((x) => x && typeof x === 'object' && typeof x.name === 'string' && 'value' in x)) {
          found.push({ key, headers: o.map((x) => ({ name: x.name, value: String(x.value == null ? '' : x.value) })) });
          return;
        }
        o.forEach((x) => walk(x, key));
      } else if (o && typeof o === 'object') {
        const entries = Object.entries(o);
        if (entries.length && entries.every(([k, v]) => TOKEN.test(k) && (typeof v === 'string' || typeof v === 'number' ||
          (Array.isArray(v) && v.every((x) => typeof x === 'string'))))) {
          const headers = [];
          for (const [k, v] of entries) for (const x of [].concat(v)) headers.push({ name: k, value: String(x) });
          found.push({ key, headers });
          return;
        }
        for (const [k, v] of entries) walk(v, k);
      }
    })(data, '');
    if (!found.length) return null;
    // Firefox "Copy All" in the Headers panel: {"Response Headers (1.2 kB)": {"headers": [...]}, "Request Headers ...": ...}
    const pick = found.find((f) => /response/i.test(f.key)) || found.find((f) => !/request/i.test(f.key)) || null;
    if (!pick) return null;
    return { source: 'json', headers: pick.headers };
  }

  /**
   * Parse pasted response headers. Returns null when nothing in the text looks like a
   * header, else { source, status, url, host, scheme, headers: [{ name, value }], responses, notes }.
   * source: 'raw' (Name: value lines), 'list' (name and value on separate lines, as a
   * selection copied from DevTools' non-raw view), 'json' or 'curl -v'.
   */
  function parseResponse(text) {
    let t = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (!t.trim()) return null;
    const notes = [];
    let url = '';
    let status = null;
    let source = 'raw';
    let headers = null;
    let responses = 1;

    if (/^\s*[[{]/.test(t)) {
      const j = fromJSON(t.trim());
      if (j) { source = j.source; headers = j.headers; }
    }

    if (!headers) {
      let lines = t.split('\n').map((l) => l.replace(/\s+$/, ''));
      // curl -v: "< " lines are the response, "> " the request, "* " curl's own notes.
      if (lines.filter((l) => /^< /.test(l)).length >= 2) {
        source = 'curl -v';
        for (const l of lines) {
          const m = /^> (?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) (\S+) HTTP/.exec(l);
          const h = /^> Host: (\S+)/i.exec(l);
          if (m && /^https?:/.test(m[1])) url = m[1];
          else if (h && !url) url = 'https://' + h[1] + '/';
        }
        const tried = lines.map((l) => /^\* Connected to (\S+)/.exec(l)).filter(Boolean);
        if (!url && tried.length) url = 'https://' + tried[tried.length - 1][1] + '/';
        lines = lines.filter((l) => /^< ?/.test(l) && !/^<\s*$/.test(l)).map((l) => l.replace(/^< ?/, ''));
      }
      // A first pass: pick out the URL, Chrome's General section, section headings and
      // request headers, so only response lines remain (status lines kept, to split on).
      const kept = [];
      let section = 'response';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) { kept.push(''); continue; }
        let m;
        if ((m = /^(?:\$\s+)?curl(?:\.exe)?\s+(.*)$/i.exec(line))) {
          const u = /(?:^|\s)['"]?(https?:\/\/[^\s'"]+)/i.exec(m[1]);
          if (u) url = u[1];
          continue;
        }
        if ((m = HEADING.exec(line))) {
          section = /request/i.test(m[1]) ? 'request' : 'response';
          if (/^raw$/i.test((lines[i + 1] || '').trim())) i++;
          continue;
        }
        if ((m = GENERAL.exec(line))) {
          let v = m[2].trim();
          if (!v && i + 1 < lines.length) v = lines[++i].trim();
          const label = lc(m[1]);
          if (label === 'request url') url = v;
          if (label === 'status code') { const s = /(\d{3})/.exec(v); if (s) status = Number(s[1]); }
          continue;
        }
        if (REQUEST_LINE.test(line)) { section = 'request'; continue; }
        if (STATUS_LINE.test(line)) { section = 'response'; kept.push(line); continue; }
        if (section === 'request') continue;
        if (/^raw$/i.test(line) && !kept.some(Boolean)) continue;
        kept.push(line);
      }
      // Split into responses at status lines (curl -L and -D - print one block per hop,
      // and 1xx interim responses); the last one with headers is the final response.
      const blocks = [];
      let cur = { status: null, lines: [] };
      for (const line of kept) {
        const m = STATUS_LINE.exec(line);
        if (m) { if (cur.status !== null || cur.lines.some(Boolean)) blocks.push(cur); cur = { status: Number(m[1]), lines: [] }; continue; }
        cur.lines.push(line);
      }
      blocks.push(cur);
      const real = blocks.filter((b) => b.status !== null || b.lines.some(Boolean));
      if (!real.length) return null;
      responses = real.filter((b) => b.status !== null).length || 1;
      // Follow redirects to know the final URL.
      for (const b of real.slice(0, -1)) {
        const loc = (blockPairs(b.lines).headers.find((h) => lc(h.name) === 'location') || {}).value;
        if (loc && b.status >= 300 && b.status < 400) {
          try { url = new URL(loc, url || undefined).href; } catch (e) { /* relative location without a known URL */ }
        }
      }
      const last = real[real.length - 1];
      if (last.status !== null) status = last.status;
      const parsed = blockPairs(last.lines);
      headers = parsed.headers;
      if (parsed.list && source === 'raw') source = 'list';
      if (parsed.pseudoStatus) status = parsed.pseudoStatus;
      if (parsed.skipped.length) notes.push(`Skipped ${parsed.skipped.length} line${parsed.skipped.length === 1 ? '' : 's'} that ${parsed.skipped.length === 1 ? 'is' : 'are'} not a header: ${parsed.skipped.slice(0, 3).map((s) => '"' + (s.length > 40 ? s.slice(0, 40) + '…' : s) + '"').join(', ')}${parsed.skipped.length > 3 ? ', …' : ''}.`);
      if (responses > 1) notes.push(`The text holds ${responses} responses (redirects or interim responses); only the last one${status ? ' (' + status + ')' : ''} is checked.`);
    }
    if (!headers || !headers.length) return null;
    let host = '', scheme = '';
    if (url) {
      try { const u = new URL(url); if (/^https?:$/.test(u.protocol)) { host = u.hostname; scheme = u.protocol.slice(0, -1); } } catch (e) { /* not a URL */ }
    }
    return { source, status, url, host, scheme, headers, responses, notes };
  }

  // Header lines of one response. Raw view: "name: value" per line. List view (a selection
  // copied from DevTools' non-raw table): the name on one line, the value on the next.
  function blockPairs(lines) {
    const ls = lines.map((l) => l.trim()).filter(Boolean);
    const pairLike = ls.filter((l) => { const i = l.indexOf(':'); return i > 0 && TOKEN.test(l.slice(0, i).trim()) && l.slice(i + 1).trim(); }).length;
    const bare = ls.filter((l) => /^:?[!#$%&'*+.^_`|~0-9A-Za-z-]+:?$/.test(l)).length;
    const list = bare >= 2 && bare >= pairLike;
    const headers = [], skipped = [];
    let pseudoStatus = null;
    for (let i = 0; i < ls.length; i++) {
      const line = ls[i];
      let name, value;
      if (list) {
        if (!/^:?[!#$%&'*+.^_`|~0-9A-Za-z-]+:?$/.test(line)) {
          // A "name: value" line can still appear in a list copy.
          const k = line.indexOf(':', 1);
          if (k > 0 && TOKEN.test(line.slice(0, k).trim())) { name = line.slice(0, k); value = line.slice(k + 1); } else { skipped.push(line); continue; }
        } else {
          name = line.replace(/:$/, '');
          value = i + 1 < ls.length ? ls[++i].replace(/^:\s*/, '') : '';
        }
      } else {
        const k = line.indexOf(':', line[0] === ':' ? 1 : 0);
        if (k <= 0) { skipped.push(line); continue; }
        name = line.slice(0, k); value = line.slice(k + 1);
      }
      name = name.trim(); value = value.trim();
      if (name[0] === ':') {
        if (lc(name) === ':status' && /^\d{3}$/.test(value)) pseudoStatus = Number(value);
        continue;
      }
      if (!TOKEN.test(name)) { skipped.push(line); continue; }
      headers.push({ name, value });
    }
    return { headers, skipped, list, pseudoStatus };
  }

  // ---------------------------------------------------------------- helpers

  function all(headers, name) { return headers.filter((h) => lc(h.name) === name).map((h) => h.value); }
  // "get, decode and split" (Fetch): every value of the header joined, split on commas.
  function list(headers, name) {
    const v = all(headers, name);
    if (!v.length) return null;
    return v.join(',').split(',').map((s) => s.trim());
  }

  function parseCsp(value) {
    // Commas separate policies; semicolons separate directives; the first of a repeated directive wins.
    return String(value).split(',').map((pol) => {
      const dirs = new Map();
      for (const part of pol.split(';')) {
        const words = part.trim().split(/\s+/).filter(Boolean);
        if (!words.length) continue;
        const name = lc(words[0]);
        if (!dirs.has(name)) dirs.set(name, words.slice(1));
      }
      return dirs;
    }).filter((d) => d.size);
  }

  const q = (s) => lc(s);
  const hasNonceOrHash = (src) => src.some((s) => /^'(nonce-|sha256-|sha384-|sha512-)/i.test(s));

  // Problems with one policy, for scripts and plugins.
  function cspIssues(pol) {
    const issues = [];
    const scripts = pol.get('script-src') || pol.get('default-src');
    const from = pol.has('script-src') ? 'script-src' : 'default-src';
    if (!scripts) issues.push('no script-src or default-src, so scripts may load from anywhere');
    else {
      const s = scripts.map(q);
      const strictDynamic = s.includes("'strict-dynamic'");
      if (s.includes("'unsafe-inline'") && !hasNonceOrHash(scripts) && !strictDynamic) issues.push(`${from} has 'unsafe-inline' without a nonce or hash, so injected inline scripts run`);
      if (s.includes("'unsafe-eval'")) issues.push(`${from} has 'unsafe-eval' (eval() and new Function() allowed)`);
      const broad = s.filter((x) => x === '*' || x === 'http:' || x === 'https:' || x === 'data:' || x === 'blob:');
      if (broad.length && !strictDynamic) issues.push(`${from} allows ${broad.join(' ')}, which lets scripts load from any host`);
    }
    if (!pol.has('object-src') && !pol.has('default-src')) issues.push("no object-src or default-src, so <object> and <embed> are not restricted (use object-src 'none')");
    return issues;
  }

  function hstsParse(value) {
    const dirs = new Map();
    let dup = false;
    for (const part of value.split(';')) {
      const p = part.trim();
      if (!p) continue;
      const eq = p.indexOf('=');
      const name = lc(eq < 0 ? p : p.slice(0, eq)).trim();
      const v = eq < 0 ? null : p.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1');
      if (dirs.has(name)) dup = true;
      dirs.set(name, v);
    }
    return { dirs, dup };
  }

  // Structured-field dictionary, loosely: key=value members split on top-level commas.
  function permissionsPolicyOk(value) {
    const members = [];
    let depth = 0, quoted = false, cur = '';
    for (const c of value) {
      if (c === '"') quoted = !quoted;
      if (!quoted && c === '(') depth++;
      if (!quoted && c === ')') depth--;
      if (!quoted && depth === 0 && c === ',') { members.push(cur); cur = ''; continue; }
      cur += c;
    }
    members.push(cur);
    const item = '(?:"[^"]*"|[A-Za-z*][!#$%&\'*+.^_`|~0-9A-Za-z:/-]*)';
    const re = new RegExp('^[a-z*][a-z0-9_.*-]*(?:=(?:\\(\\s*(?:' + item + '(?:\\s+' + item + ')*)?\\s*\\)|' + item + '))?(?:;[a-z*][a-z0-9_.*-]*(?:=\\S+)?)*$');
    return members.map((m) => m.trim()).filter(Boolean).every((m) => re.test(m));
  }

  const firstToken = (v) => lc(String(v).split(';')[0].trim()).replace(/^"(.*)"$/, '$1');

  function parseCookie(value) {
    const parts = value.split(';');
    const pair = parts.shift();
    const eq = pair.indexOf('=');
    const name = (eq < 0 ? '' : pair.slice(0, eq)).trim();
    const attrs = new Map();
    for (const p of parts) {
      const i = p.indexOf('=');
      const k = lc((i < 0 ? p : p.slice(0, i)).trim());
      if (k) attrs.set(k, i < 0 ? '' : p.slice(i + 1).trim());
    }
    return { name, attrs };
  }

  // ---------------------------------------------------------------- verdicts

  /**
   * Verdicts for the parsed response. opts.now (ms) is used for cookie expiry.
   * Returns { rows: [{ key, header, verdict, reason, value }], counts, page, https }.
   * verdict: 'good' | 'weak' | 'missing' | 'na' (not applicable).
   */
  function check(res, opts) {
    const now = (opts && opts.now) || Date.now();
    const H = res.headers;
    const has = (n) => all(H, n).length > 0;
    const one = (n) => all(H, n).join(', ');
    const ctype = lc(one('content-type'));
    const redirect = res.status >= 300 && res.status < 400;
    // A page: HTML (or unknown type). Headers that only affect documents are "not applicable" otherwise.
    const page = !redirect && (!ctype || /text\/html|application\/xhtml\+xml/.test(ctype));
    const notPage = redirect ? `this is a ${res.status} redirect, not a page` : `this response is ${ctype.split(';')[0]}, not an HTML page`;
    const rows = [];
    const row = (key, header, verdict, reason, value) => rows.push({ key, header, verdict, reason, value: value == null ? '' : value });

    // Content-Security-Policy
    const enforced = all(H, 'content-security-policy').flatMap(parseCsp);
    const reportOnly = all(H, 'content-security-policy-report-only').flatMap(parseCsp);
    {
      const value = one('content-security-policy') || one('content-security-policy-report-only');
      if (enforced.length) {
        // Every policy must allow a script for it to run, so one strict policy is enough.
        const sets = enforced.map(cspIssues);
        const best = sets.reduce((a, b) => (b.length < a.length ? b : a));
        if (best.length) row('csp', 'Content-Security-Policy', 'weak', best.join('; ') + '.', value);
        else row('csp', 'Content-Security-Policy', 'good', 'Scripts are limited without unsafe-inline or unsafe-eval, and plugins are restricted.' + (enforced.length > 1 ? ' (' + enforced.length + ' policies; a resource must pass all of them.)' : ''), value);
      } else if (reportOnly.length) {
        const issues = cspIssues(reportOnly[0]);
        row('csp', 'Content-Security-Policy', 'weak', 'Only Content-Security-Policy-Report-Only is sent: violations are reported, nothing is blocked.' + (issues.length ? ' The report-only policy also has: ' + issues.join('; ') + '.' : ''), value);
      } else if (page) {
        row('csp', 'Content-Security-Policy', 'missing', 'No policy, so an injected <script> runs with the page\'s full rights. Start with Report-Only (below) to see what a policy would block.');
      } else {
        row('csp', 'Content-Security-Policy', 'na', `Not sent; ${notPage}. A CSP protects documents. For API responses, default-src 'none'; frame-ancestors 'none' is a cheap extra.`);
      }
    }

    // Framing: CSP frame-ancestors (enforced) wins over X-Frame-Options.
    {
      const fa = enforced.map((p) => p.get('frame-ancestors')).filter(Boolean);
      const xfo = list(H, 'x-frame-options');
      const xfoSet = xfo ? [...new Set(xfo.map(lc).filter(Boolean))] : [];
      const label = 'X-Frame-Options / frame-ancestors';
      const shown = [fa.length ? 'frame-ancestors ' + fa[0].join(' ') : '', xfo ? 'X-Frame-Options: ' + one('x-frame-options') : ''].filter(Boolean).join(' · ');
      if (fa.length) {
        const open = fa.every((src) => src.map(q).some((s) => s === '*' || s === 'https:' || s === 'http:'));
        const also = xfo ? ' Browsers ignore X-Frame-Options when frame-ancestors is present.' : '';
        if (open) row('framing', label, 'weak', 'frame-ancestors lets any site frame the page (clickjacking).' + also, shown);
        else row('framing', label, 'good', `frame-ancestors ${fa[0].join(' ')} decides who may frame the page.` + also, shown);
      } else if (xfoSet.length > 1) {
        if (xfoSet.some((v) => v === 'deny' || v === 'sameorigin' || v === 'allowall')) row('framing', label, 'good', 'Conflicting X-Frame-Options values: browsers then block all framing. Send one value.', shown);
        else row('framing', label, 'weak', 'Several unknown X-Frame-Options values: browsers ignore them.', shown);
      } else if (xfoSet[0] === 'deny' || xfoSet[0] === 'sameorigin') {
        row('framing', label, 'good', (xfoSet[0] === 'deny' ? 'No site may frame the page.' : 'Only pages from the same origin may frame it.') + ' CSP frame-ancestors is the modern equivalent.', shown);
      } else if (xfoSet.length) {
        row('framing', label, 'weak', /^allow-from/.test(xfoSet[0]) ? 'ALLOW-FROM is obsolete: current browsers ignore it, so any site can frame the page. Use CSP frame-ancestors.' : `"${one('x-frame-options')}" is not DENY or SAMEORIGIN, so browsers ignore it.`, shown);
      } else if (reportOnly.some((p) => p.has('frame-ancestors'))) {
        row('framing', label, page ? 'weak' : 'na', 'frame-ancestors is only in the Report-Only policy, so framing is reported, not blocked.', one('content-security-policy-report-only'));
      } else if (page) {
        row('framing', label, 'missing', 'Any site can show this page in an iframe (clickjacking). Send frame-ancestors in the CSP or X-Frame-Options: SAMEORIGIN.');
      } else {
        row('framing', label, 'na', `Not sent; ${notPage}. Framing protection matters for pages.`);
      }
    }

    // Strict-Transport-Security
    {
      const v = all(H, 'strict-transport-security');
      const name = 'Strict-Transport-Security';
      if (res.scheme === 'http') {
        row('hsts', name, 'na', 'This response came over plain HTTP; browsers ignore HSTS there (RFC 6797 §8.1). Redirect to HTTPS and send it on the HTTPS response.', v[0]);
      } else if (!v.length) {
        row('hsts', name, 'missing', 'Browsers may still try plain HTTP first (a typed URL or an old link), where traffic can be intercepted.');
      } else {
        const { dirs, dup } = hstsParse(v[0]);
        const ma = dirs.get('max-age');
        const sub = dirs.has('includesubdomains'), pre = dirs.has('preload');
        const more = v.length > 1 ? ' Several headers were sent; browsers use only the first.' : '';
        if (dup) row('hsts', name, 'weak', 'A directive appears twice, which makes the header invalid, so browsers ignore it (RFC 6797 §6.1).' + more, v[0]);
        else if (ma == null || !/^\d+$/.test(ma)) row('hsts', name, 'weak', 'No valid max-age, so browsers ignore the header.' + more, v[0]);
        else if (Number(ma) === 0) row('hsts', name, 'weak', 'max-age=0 tells browsers to forget the policy.' + more, v[0]);
        else if (Number(ma) < HALF_YEAR) row('hsts', name, 'weak', `max-age is ${days(ma)}; use at least 6 months (15552000), commonly 1 year (31536000).` + more, v[0]);
        else if (pre && (Number(ma) < YEAR || !sub)) row('hsts', name, 'weak', 'preload is set, but the preload list requires max-age of at least 31536000 and includeSubDomains.' + more, v[0]);
        else row('hsts', name, 'good', `max-age is ${days(ma)}` + (sub ? ', subdomains included' : '; without includeSubDomains, subdomains are not covered') + (pre ? ', preload requested' : '') + '.' + more, v[0]);
      }
    }

    // X-Content-Type-Options
    {
      const v = list(H, 'x-content-type-options');
      if (!v) row('xcto', 'X-Content-Type-Options', 'missing', 'Browsers may guess ("sniff") the type of a response, e.g. run an upload as a script. Send nosniff.');
      else if (lc(v[0]) === 'nosniff') row('xcto', 'X-Content-Type-Options', 'good', 'nosniff: scripts and styles must have the right Content-Type.', one('x-content-type-options'));
      else row('xcto', 'X-Content-Type-Options', 'weak', 'The only valid value is nosniff; browsers ignore anything else.', one('x-content-type-options'));
    }

    // Referrer-Policy: the last recognised value wins.
    {
      const POLICIES = ['no-referrer', 'no-referrer-when-downgrade', 'same-origin', 'origin', 'strict-origin', 'origin-when-cross-origin', 'strict-origin-when-cross-origin', 'unsafe-url'];
      const v = list(H, 'referrer-policy');
      const name = 'Referrer-Policy';
      if (!v) {
        row('referrer', name, page ? 'missing' : 'na', page ? 'Browsers default to strict-origin-when-cross-origin, which is reasonable; set it explicitly so older browsers and every page agree.' : `Not sent; ${notPage}.`);
      } else {
        const pol = v.map(lc).filter((x) => POLICIES.includes(x)).pop();
        if (!pol) row('referrer', name, 'weak', 'No recognised value, so browsers use their default.', one('referrer-policy'));
        else if (pol === 'unsafe-url') row('referrer', name, 'weak', 'unsafe-url sends the full URL (path and query) to every site, even over plain HTTP.', one('referrer-policy'));
        else if (pol === 'no-referrer-when-downgrade') row('referrer', name, 'weak', 'Sends the full URL (path and query) to other HTTPS sites.', one('referrer-policy'));
        else row('referrer', name, 'good', `${pol}: other sites get at most the origin.`, one('referrer-policy'));
      }
    }

    // Permissions-Policy
    {
      const v = one('permissions-policy');
      const name = 'Permissions-Policy';
      if (v) {
        if (/'(none|self)'/.test(v) || (/;/.test(v) && !/=/.test(v))) row('permissions', name, 'weak', 'This is the old Feature-Policy syntax (camera \'none\'); Permissions-Policy is written camera=(). Browsers ignore it as is.', v);
        else if (!permissionsPolicyOk(v)) row('permissions', name, 'weak', 'Not a valid structured-field dictionary (feature=(allowlist), …); browsers ignore an invalid header.', v);
        else row('permissions', name, 'good', 'Limits which browser features the page and its iframes may use.', v);
      } else if (has('feature-policy')) {
        row('permissions', name, page ? 'weak' : 'na', 'Only the old Feature-Policy header is sent; current browsers read Permissions-Policy.', one('feature-policy'));
      } else if (page) {
        row('permissions', name, 'missing', 'Optional hardening: switch off features the site does not use (camera, microphone, geolocation …) for the page and its iframes.');
      } else {
        row('permissions', name, 'na', `Not sent; ${notPage}.`);
      }
    }

    // Cross-Origin-Opener-Policy
    {
      const v = one('cross-origin-opener-policy');
      const name = 'Cross-Origin-Opener-Policy';
      const t = firstToken(v);
      if (!v) row('coop', name, page ? 'missing' : 'na', page ? 'Pages you open, and pages that open you, keep a handle to your window (cross-site leaks). same-origin cuts it; same-origin-allow-popups keeps OAuth-style popups working.' : `Not sent; ${notPage}.`);
      else if (t === 'same-origin' || t === 'same-origin-allow-popups' || t === 'noopener-allow-popups') row('coop', name, 'good', `${t}: cross-origin windows lose the handle to this one.`, v);
      else if (t === 'unsafe-none') row('coop', name, page ? 'weak' : 'na', 'unsafe-none is the default: no isolation.', v);
      else row('coop', name, 'weak', 'Unknown value; browsers treat it as unsafe-none.', v);
    }

    // Cross-Origin-Embedder-Policy
    {
      const v = one('cross-origin-embedder-policy');
      const name = 'Cross-Origin-Embedder-Policy';
      const t = firstToken(v);
      const coop = firstToken(one('cross-origin-opener-policy'));
      if (!v) row('coep', name, 'na', 'Only needed for cross-origin isolation (SharedArrayBuffer, precise timers); it can break third-party embeds, so its absence is normal.');
      else if (t === 'require-corp' || t === 'credentialless') row('coep', name, 'good', `${t}` + (coop === 'same-origin' ? '; with COOP same-origin the page is cross-origin isolated.' : '; add COOP same-origin for cross-origin isolation.'), v);
      else if (t === 'unsafe-none') row('coep', name, 'na', 'unsafe-none is the default.', v);
      else row('coep', name, 'weak', 'Unknown value; browsers treat it as unsafe-none.', v);
    }

    // Cross-Origin-Resource-Policy
    {
      const v = one('cross-origin-resource-policy');
      const name = 'Cross-Origin-Resource-Policy';
      const t = lc(v.trim());
      if (!v) row('corp', name, 'missing', 'Other sites can embed this response with <img>, <script> and the like. same-origin or same-site stops that; cross-origin says it is meant to be public.');
      else if (t === 'same-origin' || t === 'same-site') row('corp', name, 'good', `${t}: other sites cannot load this response with no-cors requests.`, v);
      else if (t === 'cross-origin') row('corp', name, 'good', 'cross-origin: any site may embed it (right for public assets and CDNs).', v);
      else row('corp', name, 'weak', 'Unknown value; browsers ignore it.', v);
    }

    // Set-Cookie: one row per cookie.
    for (const sc of all(H, 'set-cookie')) {
      const { name, attrs } = parseCookie(sc);
      const label = 'Set-Cookie ' + (name || '(no name)');
      const shownAttrs = sc.split(';').slice(1).map((s) => s.trim()).filter(Boolean).join('; ');
      const shown = (name || '') + '=…' + (shownAttrs ? '; ' + shownAttrs : '');
      const maxAge = attrs.has('max-age') ? Number(attrs.get('max-age')) : null;
      const exp = attrs.has('expires') ? Date.parse(attrs.get('expires')) : NaN;
      if ((maxAge != null && maxAge <= 0) || (maxAge == null && !isNaN(exp) && exp < now)) {
        row('cookie', label, 'na', 'This response deletes the cookie.', shown);
        continue;
      }
      const secure = attrs.has('secure'), httpOnly = attrs.has('httponly');
      const ss = attrs.has('samesite') ? lc(attrs.get('samesite')) : '';
      const bad = [], weak = [];
      if (/^__secure-/i.test(name) && !secure) bad.push('the __Secure- prefix requires Secure, so browsers reject it');
      if (/^__host-/i.test(name) && (!secure || attrs.has('domain') || attrs.get('path') !== '/')) bad.push('the __Host- prefix requires Secure, Path=/ and no Domain, so browsers reject it');
      if (ss === 'none' && !secure) bad.push('SameSite=None without Secure is rejected by browsers');
      if (!secure && !(ss === 'none')) weak.push('no Secure, so it is also sent over plain HTTP');
      if (!httpOnly) weak.push('no HttpOnly, so scripts (and an XSS bug) can read it; leave it off only for cookies your JavaScript must read');
      if (!ss) weak.push('no SameSite: Chrome treats it as Lax, other browsers may send it on cross-site requests');
      else if (!['lax', 'strict', 'none'].includes(ss)) weak.push(`SameSite=${attrs.get('samesite')} is not Lax, Strict or None`);
      const issues = bad.concat(weak);
      if (issues.length) row('cookie', label, 'weak', cap(issues.join('; ')) + '.', shown);
      else row('cookie', label, 'good', `Secure, HttpOnly, SameSite=${cap(ss)}.`, shown);
    }

    // CORS
    {
      const acao = all(H, 'access-control-allow-origin');
      const creds = lc(one('access-control-allow-credentials').trim()) === 'true';
      const name = 'Access-Control-Allow-Origin';
      const v = acao.join(', ');
      if (!acao.length) row('cors', name, 'na', 'No CORS headers: scripts on other sites cannot read this response (the safe default).');
      else if (acao.length > 1 || /,/.test(v)) row('cors', name, 'weak', 'More than one origin: the header allows exactly one (or *), so browsers reject the response.', v);
      else if (v.trim() === '*' && creds) row('cors', name, 'weak', '* together with Access-Control-Allow-Credentials: true is invalid; browsers block credentialed requests. Do not "fix" it by echoing any Origin back.', v + ' + credentials');
      else if (v.trim() === '*') row('cors', name, 'good', 'Any site can read this response, but without cookies: fine for public data, not for anything behind a login.', v);
      else if (lc(v.trim()) === 'null') row('cors', name, 'weak', '"null" is the origin of sandboxed iframes and local files, which any site can create, so it opens the response to everyone.', v + (creds ? ' + credentials' : ''));
      else {
        const vary = (list(H, 'vary') || []).map(lc);
        const varyOk = vary.includes('origin') || vary.includes('*');
        row('cors', name, 'good', `Only ${v.trim()} may read it` + (creds ? ', with cookies' : '') + '.' + (varyOk ? '' : ' If the server picks the origin per request, also send Vary: Origin so caches keep them apart.'), v + (creds ? ' + credentials' : ''));
      }
    }

    // Info leaks
    {
      const leaks = [];
      const server = one('server');
      if (server && /\d/.test(server)) leaks.push(['Server', server, 'Reveals the exact software version, which makes matching known vulnerabilities easy. Drop the version (nginx: server_tokens off; Apache: ServerTokens Prod).']);
      for (const [h, label] of [['x-powered-by', 'X-Powered-By'], ['x-aspnet-version', 'X-AspNet-Version'], ['x-aspnetmvc-version', 'X-AspNetMvc-Version']]) {
        if (has(h)) leaks.push([label, one(h), 'Names the framework' + (/\d/.test(one(h)) ? ' and its version' : '') + ' and protects nothing; remove it.']);
      }
      if (leaks.length) leaks.forEach(([h, v, why]) => row('leak', h, 'weak', why, v));
      else row('leak', 'Server / X-Powered-By', 'good', server ? `Server: ${server} names no version, and there is no X-Powered-By.` : 'No software versions are announced.', server);
    }

    // X-XSS-Protection: only when sent.
    {
      const v = one('x-xss-protection');
      if (v) {
        if (v.trim() === '0') row('xxss', 'X-XSS-Protection', 'good', '0 switches off the old XSS filter, which is what current advice says (use a CSP instead).', v);
        else row('xxss', 'X-XSS-Protection', 'weak', 'Obsolete: current browsers have no XSS filter, and in old ones it could itself leak data. Send 0 or drop it, and rely on a CSP.', v);
      }
    }

    const counts = { good: 0, weak: 0, missing: 0, na: 0 };
    rows.forEach((r) => counts[r.verdict]++);
    return { rows, counts, page, https: res.scheme !== 'http' };
  }

  function days(sec) {
    const d = Number(sec) / 86400;
    if (d >= 365) return (Math.round(d / 36.5) / 10) + ' years';
    if (d >= 1) return Math.round(d) + (Math.round(d) === 1 ? ' day' : ' days');
    return sec + (Number(sec) === 1 ? ' second' : ' seconds');
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------------------------------------------------------------- suggestions

  const STARTER_CSP = "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";

  // A CSP to start testing from: the site's own policy with the missing safety directives
  // added, or a starter policy.
  function starterCsp(res) {
    const H = res.headers;
    const src = all(H, 'content-security-policy')[0] || all(H, 'content-security-policy-report-only')[0];
    if (!src) {
      const xfo = lc((list(H, 'x-frame-options') || [''])[0]);
      return xfo === 'deny' ? STARTER_CSP.replace("frame-ancestors 'self'", "frame-ancestors 'none'") : STARTER_CSP;
    }
    const pol = src.split(',')[0].split(';').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const names = pol.map((d) => lc(d.split(' ')[0]));
    if (!names.includes('object-src')) pol.push("object-src 'none'");
    if (!names.includes('base-uri')) pol.push("base-uri 'self'");
    if (!names.includes('frame-ancestors')) pol.push(lc((list(H, 'x-frame-options') || [''])[0]) === 'deny' ? "frame-ancestors 'none'" : "frame-ancestors 'self'");
    return pol.join('; ');
  }

  /**
   * Header values worth trying, as [{ key, name, value, on, why }]. on: ticked by default
   * (the matching verdict was weak or missing). The CSP row's name is
   * Content-Security-Policy-Report-Only; the page can switch it to the enforced header.
   */
  function suggestions(res, result) {
    const v = {};
    result.rows.forEach((r) => { if (!v[r.key] || r.verdict === 'weak' || r.verdict === 'missing') v[r.key] = r.verdict; });
    const bad = (k) => v[k] === 'weak' || v[k] === 'missing';
    const out = [];
    out.push({ key: 'csp', name: 'Content-Security-Policy-Report-Only', value: starterCsp(res), on: bad('csp'),
      why: 'Report-Only blocks nothing: the DevTools Console lists what the policy would block. Switch to the enforced header once it is quiet.' });
    if (result.https) out.push({ key: 'hsts', name: 'Strict-Transport-Security', value: 'max-age=300', on: bad('hsts'),
      why: 'Short on purpose: the browser stores the policy for max-age seconds, even after you switch the row off. Deploy with max-age=31536000; includeSubDomains.' });
    out.push({ key: 'xcto', name: 'X-Content-Type-Options', value: 'nosniff', on: bad('xcto'), why: 'Check that scripts and styles still load (each needs the right Content-Type).' });
    out.push({ key: 'referrer', name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin', on: bad('referrer'), why: 'Other sites get only the origin.' });
    out.push({ key: 'framing', name: 'X-Frame-Options', value: 'SAMEORIGIN', on: bad('framing'), why: 'For browsers and pages without an enforced frame-ancestors.' });
    out.push({ key: 'permissions', name: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()', on: false, why: 'Remove any feature the site uses before ticking.' });
    out.push({ key: 'coop', name: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups', on: false, why: 'Test sign-in popups and payment windows with it on.' });
    return out;
  }

  // ---------------------------------------------------------------- profile

  // A host usable as a Domain filter (what HeaderDial's filterProblem accepts), or ''.
  function cleanHost(h) {
    let s = lc(String(h || '').trim());
    try { if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = new URL(s).hostname; } catch (e) { return ''; }
    s = s.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
    return /^[a-z0-9.-]+$/.test(s) && /[a-z0-9]/.test(s) ? s : '';
  }

  /**
   * A HeaderDial profile setting the given response headers ([{ name, value }]), limited
   * to host (a Domain filter, subdomains included) when one is given.
   */
  function buildProfile(rows, opts) {
    const HD = root.HeaderDial;
    if (!HD || !HD.newProfile) throw new Error('HeaderDial model.js is not loaded');
    const o = opts || {};
    const host = cleanHost(o.host);
    const headers = rows.filter((r) => r.name && String(r.name).trim()).map((r) => HD.newHeader('response', {
      name: String(r.name).trim(), value: String(r.value == null ? '' : r.value).replace(/\s+/g, ' ').trim(), op: 'set' }));
    const filters = host ? [HD.newFilter('include', { type: 'domain', value: host })] : [];
    const name = 'Security headers test' + (host ? ' (' + host + ')' : '');
    return HD.normalizeProfile(HD.newProfile(o.index || 0, { name, headers, filters }), o.index || 0);
  }

  const api = { parseResponse, check, suggestions, starterCsp, buildProfile, cleanHost, parseCsp, STARTER_CSP };
  root.HeadersCheck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
