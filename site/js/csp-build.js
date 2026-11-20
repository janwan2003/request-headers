// Content Security Policy builder for site/guides/csp-builder.html. Parses a pasted policy
// (header line, bare value, <meta> tag, nginx add_header or Apache Header line) into
// directives, maps directives to and from the builder's rows, lists weak spots, writes
// server snippets, and builds a HeaderDial profile that tests the policy on one host.
// No browser APIs at load time, so `node --test` can require it. Building a profile needs
// window.HeaderDial (extension/lib/model.js), loaded before it.
(function (root) {
  'use strict';
  const lc = (s) => String(s).toLowerCase();

  const ENFORCE = 'Content-Security-Policy';
  const REPORT_ONLY = 'Content-Security-Policy-Report-Only';
  // The nonce chip inserts this. It is not a valid nonce on purpose: the server has to
  // replace it with a fresh random value on every response.
  const NONCE_PLACEHOLDER = "'nonce-{RANDOM}'";

  // Source keywords offered as toggles. `match` recognises an existing token as this chip.
  const CHIPS = {
    self: { token: "'self'", label: "'self'" },
    none: { token: "'none'", label: "'none'" },
    'unsafe-inline': { token: "'unsafe-inline'", label: "'unsafe-inline'" },
    'unsafe-eval': { token: "'unsafe-eval'", label: "'unsafe-eval'" },
    'strict-dynamic': { token: "'strict-dynamic'", label: "'strict-dynamic'" },
    nonce: { token: NONCE_PLACEHOLDER, label: 'nonce', match: (t) => /^'nonce-/i.test(t) },
    https: { token: 'https:', label: 'https:' },
    data: { token: 'data:', label: 'data:' },
    blob: { token: 'blob:', label: 'blob:' },
  };
  const chipMatches = (key, token) => (CHIPS[key].match ? CHIPS[key].match(token) : lc(token) === CHIPS[key].token);

  const FETCH = ['self', 'none', 'https', 'data', 'blob'];
  const SCRIPT = ['self', 'none', 'nonce', 'strict-dynamic', 'unsafe-inline', 'unsafe-eval', 'https', 'data', 'blob'];
  // The directives the builder shows, in output order. kind: sources (keyword chips and a
  // free-text list), flag (no value), urls (report-uri), group (report-to).
  const DIRECTIVES = [
    { name: 'default-src', kind: 'sources', chips: SCRIPT, help: 'Fallback for the other -src directives you leave out (not for base-uri, form-action or frame-ancestors).' },
    { name: 'script-src', kind: 'sources', chips: SCRIPT, help: 'JavaScript: <script> files, inline scripts, event handler attributes, eval().' },
    { name: 'style-src', kind: 'sources', chips: ['self', 'none', 'unsafe-inline', 'nonce', 'https', 'data'], help: 'Stylesheets, <style> blocks and style="" attributes.' },
    { name: 'img-src', kind: 'sources', chips: FETCH, help: 'Images and favicons.' },
    { name: 'font-src', kind: 'sources', chips: FETCH, help: 'Web fonts loaded with @font-face.' },
    { name: 'connect-src', kind: 'sources', chips: FETCH, help: 'fetch(), XMLHttpRequest, WebSocket, EventSource, sendBeacon.' },
    { name: 'media-src', kind: 'sources', chips: FETCH, help: '<audio>, <video> and <track>.' },
    { name: 'frame-src', kind: 'sources', chips: FETCH, help: 'What this page may load in <iframe> and <frame>.' },
    { name: 'worker-src', kind: 'sources', chips: ['self', 'none', 'https', 'blob'], help: 'Web workers, shared workers and service workers.' },
    { name: 'manifest-src', kind: 'sources', chips: FETCH, help: 'The web app manifest.' },
    { name: 'object-src', kind: 'sources', chips: ['self', 'none'], help: "<object> and <embed>. 'none' is the usual setting." },
    { name: 'base-uri', kind: 'sources', chips: ['self', 'none', 'https'], help: 'Allowed <base href> URLs. Does not fall back to default-src.' },
    { name: 'form-action', kind: 'sources', chips: ['self', 'none', 'https'], help: 'Where forms may submit. Does not fall back to default-src.' },
    { name: 'frame-ancestors', kind: 'sources', chips: ['self', 'none', 'https'], help: 'Which sites may put this page in a frame (clickjacking). Header only; ignored in <meta>.' },
    { name: 'upgrade-insecure-requests', kind: 'flag', chips: [], help: 'Load http:// subresources and same-site links over https:// instead.' },
    { name: 'report-uri', kind: 'urls', chips: [], help: 'Older reporting: URLs that receive JSON reports. Deprecated, still widely supported.' },
    { name: 'report-to', kind: 'group', chips: [], help: 'Reporting API group name; needs a Reporting-Endpoints header (field below).' },
  ];
  const BY_NAME = new Map(DIRECTIVES.map((d) => [d.name, d]));

  // Directive names from CSP Level 3 and related specs that browsers recognise.
  const KNOWN = new Set(DIRECTIVES.map((d) => d.name).concat(['script-src-elem', 'script-src-attr', 'style-src-elem',
    'style-src-attr', 'child-src', 'prefetch-src', 'fenced-frame-src', 'sandbox', 'require-trusted-types-for',
    'trusted-types', 'webrtc', 'block-all-mixed-content']));
  // Removed from the specification (or never shipped): browsers ignore them.
  const REMOVED = new Set(['plugin-types', 'navigate-to', 'referrer', 'reflected-xss', 'require-sri-for', 'disown-opener']);
  const KEYWORDS = new Set(["'self'", "'none'", "'unsafe-inline'", "'unsafe-eval'", "'strict-dynamic'", "'unsafe-hashes'",
    "'report-sample'", "'wasm-unsafe-eval'", "'inline-speculation-rules'"]);
  // Directives that hold a list of sources (so the source checks apply).
  const SOURCE_LIST = new Set(DIRECTIVES.filter((d) => d.kind === 'sources').map((d) => d.name)
    .concat(['script-src-elem', 'script-src-attr', 'style-src-elem', 'style-src-attr', 'child-src', 'prefetch-src', 'fenced-frame-src']));

  const isNonce = (t) => /^'nonce-/i.test(t);
  const isHash = (t) => /^'sha(256|384|512)-/i.test(t);
  const isPlaceholderNonce = (t) => isNonce(t) && !/^'nonce-[A-Za-z0-9+/_-]+={0,2}'$/.test(t);

  // ---------------------------------------------------------------- parsing

  // One token, tidied: keywords and schemes lower case, nonce/hash prefixes lower case
  // (their base64 value is case-sensitive), hosts as typed.
  function normToken(t) {
    const l = lc(t);
    if (KEYWORDS.has(l)) return l;
    const m = /^'(nonce|sha256|sha384|sha512)-(.*)$/i.exec(t);
    if (m) return "'" + lc(m[1]) + '-' + m[2];
    if (/^[a-z][a-z0-9+.-]*:$/i.test(t)) return l;
    return t;
  }

  const decodeEntities = (s) => s.replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  /**
   * Pasted text -> { directives: [{ name, tokens }], mode: 'report' | 'enforce' | null,
   * notes: [string], from: 'header' | 'meta' | 'nginx' | 'apache' | 'value' }.
   * Only the first policy is read when there are several (comma-separated or several
   * header lines); a repeated directive keeps its first occurrence, as browsers do.
   */
  function parsePolicy(text) {
    const notes = [];
    let s = String(text || '').trim();
    let mode = null, from = 'value';
    const out = { directives: [], mode, notes, from };
    if (!s) return out;
    const meta = /<meta\b[^>]*>/i.exec(s);
    if (meta && /http-equiv\s*=\s*["']?content-security-policy/i.test(meta[0])) {
      const c = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(meta[0]);
      s = decodeEntities(c ? (c[1] != null ? c[1] : c[2]) : '');
      mode = /content-security-policy-report-only/i.test(meta[0]) ? 'report' : 'enforce';
      from = 'meta';
    } else {
      // Several header lines (a pasted block of response headers): keep the CSP ones.
      const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const cspLines = lines.filter((l) => /^(?:add_header\s+|header\s+(?:always\s+)?(?:set|add|append|merge)\s+)?["']?content-security-policy(?:-report-only)?["']?\s*(?::|\s)/i.test(l));
      if (cspLines.length) {
        if (cspLines.length > 1) notes.push(`Found ${cspLines.length} policy headers; loaded the first. Browsers apply every policy they receive, so a resource must pass all of them.`);
        s = cspLines[0];
      } else s = lines.join(' ');
      let m;
      if ((m = /^add_header\s+["']?(content-security-policy(?:-report-only)?)["']?\s+(["'])(.*)\2(?:\s+always)?\s*;?\s*$/i.exec(s))) {
        from = 'nginx'; mode = /report-only/i.test(m[1]) ? 'report' : 'enforce'; s = m[3];
      } else if ((m = /^header\s+(?:always\s+)?(?:set|add|append|merge)\s+["']?(content-security-policy(?:-report-only)?)["']?\s+(["'])(.*)\2\s*$/i.exec(s))) {
        from = 'apache'; mode = /report-only/i.test(m[1]) ? 'report' : 'enforce'; s = m[3];
      } else if ((m = /^["']?(content-security-policy(?:-report-only)?)["']?\s*:\s*(.*)$/i.exec(s))) {
        from = 'header'; mode = /report-only/i.test(m[1]) ? 'report' : 'enforce'; s = m[2];
      }
      s = s.trim();
      const q = /^(["'])(.*)\1;?$/.exec(s);
      // Strip quotes around the whole value, but not a lone keyword like 'self'.
      if (q && /[\s;]/.test(q[2])) s = q[2];
    }
    const policies = s.split(',').map((p) => p.trim()).filter(Boolean);
    if (policies.length > 1) notes.push(`The value holds ${policies.length} policies separated by commas; loaded the first. Browsers enforce each one, so a resource must pass all of them.`);
    const seen = new Set();
    for (const part of (policies[0] || '').split(';')) {
      const words = part.trim().split(/\s+/).filter(Boolean);
      if (!words.length) continue;
      const name = lc(words[0]);
      if (!/^[a-z0-9-]+$/.test(name)) { notes.push(`Skipped "${words[0]}": not a directive name.`); continue; }
      if (seen.has(name)) { notes.push(`${name} appears more than once. Browsers use the first and ignore the rest, so the later one was dropped.`); continue; }
      seen.add(name);
      out.directives.push({ name, tokens: words.slice(1).map(normToken) });
    }
    out.mode = mode; out.from = from;
    return out;
  }

  /** Directives -> header value ("a b; c d"). */
  function serialize(directives) {
    return directives.filter((d) => d && d.name).map((d) => [d.name].concat(d.tokens || []).join(' ')).join('; ');
  }

  // ---------------------------------------------------------------- builder rows

  /**
   * Directives -> builder state: { rows: { name: { on, chips: [key], other } }, extra }.
   * `other` is the free-text sources (hosts, hashes, other keywords); `extra` holds
   * directives the builder has no row for, as policy text, so nothing pasted is lost.
   */
  function toBuilder(directives) {
    const rows = {};
    for (const d of DIRECTIVES) rows[d.name] = { on: false, chips: [], other: '' };
    const extra = [];
    for (const d of directives) {
      const def = BY_NAME.get(d.name);
      if (!def) { extra.push(d); continue; }
      const row = rows[d.name];
      row.on = true;
      const other = [];
      for (const t of d.tokens) {
        const key = def.chips.find((k) => chipMatches(k, t));
        // A real nonce stays in the free text (the chip stands for the placeholder).
        if (key && !(key === 'nonce' && !isPlaceholderNonce(t))) { if (!row.chips.includes(key)) row.chips.push(key); } else other.push(t);
      }
      row.other = other.join(' ');
    }
    return { rows, extra: serialize(extra) };
  }

  // Free text -> tokens: split on whitespace and commas; drop ";" (it would end the directive).
  const words = (s) => String(s || '').replace(/;/g, ' ').split(/[\s,]+/).filter(Boolean).map(normToken);

  /** Builder state -> directives, in the builder's order, then the extra ones. */
  function fromBuilder(b) {
    const out = [];
    for (const def of DIRECTIVES) {
      const row = b.rows[def.name];
      if (!row || !row.on) continue;
      if (def.kind === 'flag') { out.push({ name: def.name, tokens: [] }); continue; }
      const tokens = def.chips.filter((k) => row.chips.includes(k)).map((k) => CHIPS[k].token);
      for (const t of words(row.other)) if (!tokens.some((x) => lc(x) === lc(t))) tokens.push(t);
      out.push({ name: def.name, tokens });
    }
    const seen = new Set(out.map((d) => d.name));
    for (const d of parsePolicy(b.extra || '').directives) if (!seen.has(d.name)) { seen.add(d.name); out.push(d); }
    return out;
  }

  // ---------------------------------------------------------------- presets

  const PRESETS = [
    { key: 'strict', label: 'Strict starter', policy: "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
      about: "Only your own origin. Expect reports for analytics, inline scripts and third-party widgets: that is the list to work through." },
    { key: 'cdn', label: 'Typical site with a CDN', policy: "default-src 'self'; script-src 'self' https://cdn.example.com; style-src 'self' 'unsafe-inline' https://cdn.example.com; img-src 'self' https: data:; font-src 'self' https://cdn.example.com; connect-src 'self' https://api.example.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
      about: 'Replace cdn.example.com and api.example.com with your hosts. Images from any https: host, inline styles allowed, scripts only from you and the CDN.' },
    { key: 'nonce', label: 'Nonce + strict-dynamic', policy: "script-src " + NONCE_PLACEHOLDER + " 'strict-dynamic' 'unsafe-inline' https:; object-src 'none'; base-uri 'none'",
      about: "The nonce-based \"strict CSP\" pattern. Needs your server to generate the nonce; https: and 'unsafe-inline' are fallbacks that browsers supporting 'strict-dynamic' ignore." },
    { key: 'framing', label: 'Lock down framing only', policy: "frame-ancestors 'self'",
      about: 'Only stops other sites from framing the page (clickjacking). Restricts nothing else.' },
  ];

  // ---------------------------------------------------------------- warnings

  /**
   * Weak spots in a policy: [{ level: 'warn' | 'info', directive, text }].
   * opts.mode: 'report' or 'enforce' (some directives do nothing in Report-Only).
   */
  function warnings(directives, opts) {
    const o = opts || {};
    const out = [];
    const add = (level, directive, text) => out.push({ level, directive, text });
    const get = (n) => { const d = directives.find((x) => x.name === n); return d ? d.tokens : null; };
    const has = (n) => directives.some((x) => x.name === n);
    if (!directives.length) { add('info', '', 'The policy is empty. Pick a starter or tick some directives.'); return out; }

    for (const d of directives) {
      const n = d.name;
      if (REMOVED.has(n)) add('warn', n, `${n} was removed from the CSP specification; browsers ignore it.`);
      else if (!KNOWN.has(n)) add('warn', n, `${n} is not a CSP directive this page knows, so browsers will most likely ignore it. Check the spelling.`);
      if (n === 'block-all-mixed-content') add('info', n, 'block-all-mixed-content is deprecated; browsers now block or upgrade mixed content themselves. upgrade-insecure-requests is the usual choice.');
      if (!SOURCE_LIST.has(n)) continue;
      const t = d.tokens.map(lc);
      if (!t.length) add('warn', n, `${n} has no sources, which allows nothing (the same as 'none').`);
      if (t.includes("'none'") && t.length > 1) add('warn', n, `${n}: 'none' is ignored when other sources are listed with it.`);
      for (const bare of ['self', 'none', 'unsafe-inline', 'unsafe-eval', 'strict-dynamic']) {
        if (t.includes(bare)) add('warn', n, `${n}: ${bare} without single quotes is read as a host named "${bare}". Write '${bare}'.`);
      }
      for (const tok of d.tokens) {
        if (/^'.*'$/.test(tok) && !KEYWORDS.has(lc(tok)) && !isNonce(tok) && !isHash(tok)) add('warn', n, `${n}: ${tok} is not a CSP keyword; browsers ignore unknown keywords.`);
        else if (/^".*"$/.test(tok)) add('warn', n, `${n}: ${tok} uses double quotes. CSP keywords take single quotes, as in 'self'.`);
      }
      if (t.includes("'strict-dynamic'") && !/^(script-src|script-src-elem|default-src)$/.test(n)) add('info', n, `${n}: 'strict-dynamic' only has an effect on scripts (script-src, or default-src when there is no script-src).`);
    }

    const scriptFrom = has('script-src') ? 'script-src' : has('default-src') ? 'default-src' : '';
    if (!scriptFrom) {
      add('warn', 'script-src', 'No script-src or default-src: scripts can load from anywhere and inline scripts run. That is only fine if this policy is meant for something else, such as framing.');
    } else {
      const src = get(scriptFrom);
      const t = src.map(lc);
      const strictDynamic = t.includes("'strict-dynamic'");
      // The placeholder counts: the server will turn it into a real nonce.
      const nonceOrHash = src.some((x) => isNonce(x) || isHash(x));
      if (t.includes("'unsafe-inline'") && !nonceOrHash && !strictDynamic) {
        add('warn', scriptFrom, `${scriptFrom} has 'unsafe-inline' without a nonce or hash, so any injected inline script runs. With a nonce or hash in the list, browsers ignore 'unsafe-inline'.`);
      }
      if (t.includes("'unsafe-eval'")) add('warn', scriptFrom, `${scriptFrom} has 'unsafe-eval': strings can become code through eval(), new Function() and string timers.`);
      const broad = t.filter((x) => x === '*' || x === 'http:' || x === 'https:' || x === 'data:' || x === 'blob:');
      if (broad.length && !strictDynamic) add('warn', scriptFrom, `${scriptFrom} allows ${broad.join(' ')}, so a script from almost any URL can run. List the hosts you use instead.`);
      if (strictDynamic && !nonceOrHash) add('warn', scriptFrom, `${scriptFrom} has 'strict-dynamic' but no nonce or hash. Browsers that support 'strict-dynamic' then ignore 'self' and host sources, so no script is allowed.`);
      if (src.some(isPlaceholderNonce)) add('info', scriptFrom, `${NONCE_PLACEHOLDER} is a placeholder, not a valid nonce. Your server must replace it with a new random value (at least 128 bits, base64) on every response and put the same value in each <script nonce="…">.`);
      else if (src.some(isNonce)) add('info', scriptFrom, 'A nonce typed into a policy is the same on every response, which is only safe for a test. In real use the server generates a new one per response.');
      if (!has('object-src') && !(has('default-src') && lc(get('default-src').join(' ')) === "'none'")) {
        add('warn', 'object-src', has('default-src')
          ? "No object-src, so <object> and <embed> fall back to default-src. object-src 'none' is the usual setting."
          : "No object-src (and no default-src), so <object> and <embed> are not restricted. Add object-src 'none'.");
      }
      if (!has('base-uri')) add('warn', 'base-uri', "No base-uri, and it does not fall back to default-src: an injected <base href> could change where relative script URLs load from. Add base-uri 'self' or 'none'.");
      if (!has('form-action')) add('info', 'form-action', "No form-action. It does not fall back to default-src, so forms may submit to any URL. form-action 'self' is common.");
      if (!has('default-src')) add('info', 'default-src', 'No default-src: resource types you did not list (fonts, media, frames, connections…) are not restricted.');
    }

    const fa = get('frame-ancestors');
    if (fa) {
      const t = fa.map(lc);
      if (t.includes('*') || t.includes('https:') || t.includes('http:')) add('warn', 'frame-ancestors', `frame-ancestors ${t.filter((x) => x === '*' || x === 'https:' || x === 'http:').join(' ')} lets any site frame the page.`);
      add('info', 'frame-ancestors', 'frame-ancestors only works in a response header. Browsers ignore it in a <meta> tag.');
    } else if (scriptFrom) add('info', 'frame-ancestors', "No frame-ancestors. It does not fall back to default-src, so other sites may frame the page unless X-Frame-Options forbids it.");

    const rt = get('report-to');
    if (has('report-uri')) {
      add('info', 'report-uri', rt
        ? 'report-uri is deprecated in favour of report-to. Browsers that support report-to ignore report-uri when both are set, so sending both is the usual transition.'
        : 'report-uri is deprecated in favour of report-to, which needs a Reporting-Endpoints header. Browsers still send reports to report-uri; keeping it next to report-to covers browsers without report-to.');
      if (!get('report-uri').length) add('warn', 'report-uri', 'report-uri has no URL.');
    }
    if (rt) {
      if (rt.length !== 1) add('warn', 'report-to', 'report-to takes exactly one group name, defined in the Reporting-Endpoints header.');
      else add('info', 'report-to', `report-to ${rt[0]} needs a Reporting-Endpoints header on the same response, such as Reporting-Endpoints: ${rt[0]}="https://example.com/csp-reports". Not every browser supports report-to yet, so keep report-uri too if you need reports from all of them.`);
    }
    if (o.mode === 'report') {
      if (has('upgrade-insecure-requests')) add('info', 'upgrade-insecure-requests', 'upgrade-insecure-requests is ignored in a Report-Only policy. It only takes effect when enforced.');
      if (has('sandbox')) add('info', 'sandbox', 'sandbox is ignored in a Report-Only policy. It only takes effect when enforced.');
    }
    return out;
  }

  // ---------------------------------------------------------------- output formats

  // Not applied by browsers when the policy comes from <meta> (CSP Level 3).
  const META_IGNORED = ['frame-ancestors', 'report-uri', 'sandbox'];

  /**
   * The policy as a header line or server configuration: format is 'value', 'header',
   * 'nginx', 'apache' or 'meta'. Returns { text, note }.
   */
  function snippet(directives, format, mode) {
    const name = mode === 'report' ? REPORT_ONLY : ENFORCE;
    const value = serialize(directives);
    const dq = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    switch (format) {
      case 'header': return { text: `${name}: ${value}`, note: '' };
      case 'nginx': return { text: `add_header ${name} "${dq(value)}" always;`, note: 'In the server or location block. "always" adds it to error responses too. An add_header in a nested block replaces all add_header lines inherited from outer blocks.' };
      case 'apache': return { text: `Header always set ${name} "${dq(value)}"`, note: 'Needs mod_headers. In the VirtualHost, a Directory block or .htaccess.' };
      case 'meta': {
        const kept = directives.filter((d) => !META_IGNORED.includes(d.name));
        const dropped = directives.filter((d) => META_IGNORED.includes(d.name)).map((d) => d.name);
        const html = serialize(kept).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const notes = [];
        if (mode === 'report') notes.push('Report-Only cannot be set with a <meta> tag, so this tag enforces the policy.');
        if (dropped.length) notes.push(`Left out ${dropped.join(', ')}: browsers ignore ${dropped.length === 1 ? 'it' : 'them'} in <meta>.`);
        notes.push('Put it in <head> before any script or style it should cover.');
        return { text: `<meta http-equiv="Content-Security-Policy" content="${html}">`, note: notes.join(' ') };
      }
      default: return { text: value, note: '' };
    }
  }

  // ---------------------------------------------------------------- profile

  // A host usable as a Domain filter (what HeaderDial's filterProblem accepts), or ''.
  // Same rules as headers-check.js.
  function cleanHost(h) {
    let s = lc(String(h || '').trim());
    try { if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = new URL(s).hostname; } catch (e) { return ''; }
    s = s.replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
    return /^[a-z0-9.-]+$/.test(s) && /[a-z0-9]/.test(s) ? s : '';
  }

  /**
   * The response-header rows of the test: [{ name, value, op }].
   * opts.mode: 'report' (default) or 'enforce'. opts.removeExisting: also remove the
   * site's own Content-Security-Policy (only meaningful in Report-Only mode; in enforce
   * mode the set row already replaces it). opts.endpoint: URL for Reporting-Endpoints
   * when the policy has report-to.
   */
  function testRows(value, opts) {
    const o = opts || {};
    const v = String(value || '').replace(/\s+/g, ' ').trim();
    if (!v) return [];
    const enforce = o.mode === 'enforce';
    const rows = [];
    if (!enforce && o.removeExisting) rows.push({ name: ENFORCE, value: '', op: 'remove' });
    rows.push({ name: enforce ? ENFORCE : REPORT_ONLY, value: v, op: 'set' });
    const group = (parsePolicy(v).directives.find((d) => d.name === 'report-to') || { tokens: [] }).tokens[0];
    const endpoint = String(o.endpoint || '').trim();
    if (group && /^https:\/\/[^\s"]+$/i.test(endpoint) && /^[A-Za-z0-9_-]+$/.test(group)) {
      rows.push({ name: 'Reporting-Endpoints', value: `${group}="${endpoint}"`, op: 'set' });
    }
    return rows;
  }

  /** A HeaderDial profile with the test rows, limited to host when one is given. */
  function buildProfile(value, opts) {
    const HD = root.HeaderDial;
    if (!HD || !HD.newProfile) throw new Error('HeaderDial model.js is not loaded');
    const o = opts || {};
    const host = cleanHost(o.host);
    const headers = testRows(value, o).map((r) => HD.newHeader('response', r));
    const filters = host ? [HD.newFilter('include', { type: 'domain', value: host })] : [];
    const name = 'CSP ' + (o.mode === 'enforce' ? 'enforce' : 'Report-Only') + ' test' + (host ? ' (' + host + ')' : '');
    return HD.normalizeProfile(HD.newProfile(o.index || 0, { name, headers, filters }), o.index || 0);
  }

  const api = { DIRECTIVES, CHIPS, PRESETS, NONCE_PLACEHOLDER, ENFORCE, REPORT_ONLY, parsePolicy, serialize, toBuilder,
    fromBuilder, warnings, snippet, testRows, buildProfile, cleanHost, normToken };
  root.CspBuild = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
