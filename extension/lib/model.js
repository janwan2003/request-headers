// HeaderDial core: the saved state, its validation, and the compiler that turns
// profiles into declarativeNetRequest rules. No browser APIs in here, so the same
// file runs in the extension and under `node --test`.
(function (root) {
  'use strict';

  const SCHEMA = 1;
  const RESOURCE_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
    'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];
  // Chrome only accepts the "append" operation on these request headers.
  const APPENDABLE_REQUEST = new Set(['accept', 'accept-encoding', 'accept-language', 'access-control-request-headers',
    'cache-control', 'connection', 'content-language', 'cookie', 'forwarded', 'if-match', 'if-none-match', 'keep-alive',
    'range', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'user-agent', 'via', 'want-digest', 'x-forwarded-for']);
  // HTTP methods declarativeNetRequest can match on (lower case, as DNR expects).
  const METHODS = ['get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'connect', 'other'];
  const NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
  const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777'];
  const OPS = ['set', 'append', 'remove'];
  const FILTER_TYPES = ['pattern', 'regex', 'domain', 'initiator'];
  // Redirect modes: "replace" swaps the first occurrence of some text in the URL;
  // "regex" is a regular expression with \\1-style groups in the target.
  const REDIRECT_MODES = ['replace', 'regex'];

  function uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function newHeader(target, o) {
    return Object.assign({ id: uid(), enabled: true, target: target === 'response' ? 'response' : 'request',
      name: '', value: '', op: 'set', comment: '', expiresAt: null }, o || {});
  }

  function newFilter(kind, o) {
    return Object.assign({ id: uid(), enabled: true, kind: kind === 'exclude' ? 'exclude' : 'include',
      type: 'pattern', value: '' }, o || {});
  }

  function newRedirect(o) {
    return Object.assign({ id: uid(), enabled: true, mode: 'replace', from: '', to: '' }, o || {});
  }

  // A cookie row: "request" sends name=value in the Cookie header (added to the cookies
  // the browser already sends); "response" stores it, as if the server sent Set-Cookie.
  function newCookie(target, o) {
    const response = target === 'response';
    return Object.assign({ id: uid(), enabled: true, target: response ? 'response' : 'request',
      name: '', value: '', attrs: response ? 'Path=/' : '' }, o || {});
  }

  function newProfile(index, o) {
    const i = index || 0;
    return Object.assign({ id: uid(), name: 'Profile ' + (i + 1), color: COLORS[i % COLORS.length], active: true,
      headers: [newHeader('request')], cookies: [], redirects: [], filters: [], resourceTypes: [], requestMethods: [], tabId: null, tabLabel: '' }, o || {});
  }

  function defaultState() {
    const p = newProfile(0);
    return { schema: SCHEMA, paused: false, selectedId: p.id, profiles: [p] };
  }

  const str = (v, d) => (typeof v === 'string' ? v : v == null ? d : String(v));
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);

  function normalizeHeader(h) {
    h = h && typeof h === 'object' ? h : {};
    return {
      id: str(h.id, '') || uid(),
      enabled: bool(h.enabled, true),
      target: h.target === 'response' ? 'response' : 'request',
      name: str(h.name, ''),
      value: str(h.value, ''),
      op: OPS.includes(h.op) ? h.op : 'set',
      comment: str(h.comment, ''),
      expiresAt: typeof h.expiresAt === 'number' && isFinite(h.expiresAt) ? h.expiresAt : null,
    };
  }

  function normalizeFilter(f) {
    f = f && typeof f === 'object' ? f : {};
    return {
      id: str(f.id, '') || uid(),
      enabled: bool(f.enabled, true),
      kind: f.kind === 'exclude' ? 'exclude' : 'include',
      type: FILTER_TYPES.includes(f.type) ? f.type : 'pattern',
      value: str(f.value, ''),
    };
  }

  function normalizeRedirect(r) {
    r = r && typeof r === 'object' ? r : {};
    return {
      id: str(r.id, '') || uid(),
      enabled: bool(r.enabled, true),
      mode: REDIRECT_MODES.includes(r.mode) ? r.mode : 'replace',
      from: str(r.from, ''),
      to: str(r.to, ''),
    };
  }

  function normalizeCookie(c) {
    c = c && typeof c === 'object' ? c : {};
    return {
      id: str(c.id, '') || uid(),
      enabled: bool(c.enabled, true),
      target: c.target === 'response' ? 'response' : 'request',
      name: str(c.name, ''),
      value: str(c.value, ''),
      attrs: str(c.attrs, ''),
    };
  }

  function normalizeProfile(p, i) {
    p = p && typeof p === 'object' ? p : {};
    return {
      id: str(p.id, '') || uid(),
      name: str(p.name, '') || 'Profile ' + (i + 1),
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : COLORS[i % COLORS.length],
      active: bool(p.active, true),
      headers: Array.isArray(p.headers) ? p.headers.map(normalizeHeader) : [],
      cookies: Array.isArray(p.cookies) ? p.cookies.map(normalizeCookie) : [],
      redirects: Array.isArray(p.redirects) ? p.redirects.map(normalizeRedirect) : [],
      filters: Array.isArray(p.filters) ? p.filters.map(normalizeFilter) : [],
      resourceTypes: Array.isArray(p.resourceTypes) ? p.resourceTypes.filter((t) => RESOURCE_TYPES.includes(t)) : [],
      requestMethods: Array.isArray(p.requestMethods)
        ? [...new Set(p.requestMethods.map((m) => String(m).toLowerCase()))].filter((m) => METHODS.includes(m)) : [],
      tabId: Number.isInteger(p.tabId) ? p.tabId : null,
      tabLabel: str(p.tabLabel, ''),
    };
  }

  function normalizeState(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.profiles) || !s.profiles.length) return defaultState();
    const profiles = s.profiles.map(normalizeProfile);
    const selectedId = profiles.some((p) => p.id === s.selectedId) ? s.selectedId : profiles[0].id;
    return { schema: SCHEMA, paused: bool(s.paused, false), selectedId, profiles };
  }

  // Returns a problem message for a header row, or '' if it can be applied.
  function headerProblem(h) {
    const name = h.name.trim();
    if (!name) return '';
    if (!NAME_RE.test(name)) return 'invalid header name';
    if (h.op !== 'remove' && /[\r\n\0]/.test(h.value)) return 'value contains a line break';
    return '';
  }

  // Returns a problem message for a cookie row, or '' if it can be applied.
  function cookieProblem(c) {
    const name = c.name.trim();
    if (!name) return '';
    if (!NAME_RE.test(name)) return 'invalid cookie name';
    if (/[;\r\n\0]/.test(c.value)) return 'a cookie value cannot contain ";" or a line break';
    if (c.target === 'response' && /[\r\n\0]/.test(c.attrs)) return 'attributes contain a line break';
    return '';
  }

  function liveCookies(p) {
    return (p.cookies || []).filter((c) => c.enabled && c.name.trim() && !cookieProblem(c));
  }

  // The header row a cookie row becomes.
  function cookieInfo(c) {
    const pair = c.name.trim() + '=' + c.value.trim();
    if (c.target === 'request') return { header: 'cookie', operation: 'append', value: pair };
    const attrs = c.attrs.trim().replace(/^;\s*/, '');
    return { header: 'set-cookie', operation: 'append', value: attrs ? pair + '; ' + attrs : pair };
  }

  // Request cookie rows become one "name=value; ..." string. It is appended to the Cookie
  // header the browser sends; if a header row sets or removes Cookie, the cookies are
  // folded into that row instead, so one rule never has two operations on Cookie.
  function withCookies(list, pairs) {
    if (!pairs.length) return list;
    const joined = pairs.join('; ');
    const i = list.findIndex((x) => x.header.toLowerCase() === 'cookie' && x.operation !== 'append');
    if (i < 0) {
      const j = list.findIndex((x) => x.header.toLowerCase() === 'cookie');
      if (j < 0) return list.concat({ header: 'cookie', operation: 'append', value: joined });
      list[j] = Object.assign({}, list[j], { value: list[j].value ? list[j].value + '; ' + joined : joined });
      return list;
    }
    const x = list[i];
    list[i] = { header: x.header, operation: 'set', value: x.operation === 'set' && x.value ? x.value + '; ' + joined : joined };
    return list;
  }

  function filterProblem(f) {
    const v = f.value.trim();
    if (!v) return '';
    if (f.type === 'regex') {
      try { new RegExp(v); } catch (e) { return 'invalid regular expression'; }
    }
    if ((f.type === 'domain' || f.type === 'initiator') && !/^[a-z0-9.-]+$/i.test(v)) return 'domain must look like example.com';
    return '';
  }

  // Returns a problem message for a redirect row, or '' if it can be applied.
  function redirectProblem(r) {
    const from = r.from.trim(), to = r.to.trim();
    if (!from && !to) return '';
    if (!from) return 'say which URL to redirect';
    if (!to) return 'say where to redirect to';
    if (/\s/.test(from) || /\s/.test(to)) return 'URLs cannot contain spaces';
    if (r.mode === 'regex') {
      try { new RegExp(from); } catch (e) { return 'invalid regular expression'; }
      if (!/^[a-z][a-z0-9+.-]*:|^\\\d/i.test(to)) return 'the target must start with a scheme such as https:// or a group such as \\1';
      return '';
    }
    if (to.includes(from)) return 'the target contains the text it replaces, so it would redirect forever';
    return '';
  }

  // The replacement text for a DNR regexSubstitution: backslashes are escapes there.
  const substEscape = (t) => t.replace(/\\/g, '\\\\');
  const regexEscape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function redirectAction(r) {
    const from = r.from.trim(), to = r.to.trim();
    if (r.mode === 'regex') return { regexFilter: from, regexSubstitution: to };
    return { regexFilter: '^(.*?)' + regexEscape(from) + '(.*)$', regexSubstitution: '\\1' + substEscape(to) + '\\2' };
  }

  function liveRedirects(p) {
    return p.redirects.filter((r) => r.enabled && r.from.trim() && !redirectProblem(r));
  }

  // A header is "live" when it will be sent: enabled, named, valid and not expired.
  function liveHeaders(p, now) {
    return p.headers.filter((h) => h.enabled && h.name.trim() && !headerProblem(h) &&
      !(h.expiresAt && h.expiresAt <= now));
  }

  function headerInfo(h, problems, profile) {
    const name = h.name.trim();
    let op = h.op;
    if (op === 'append' && h.target === 'request' && !APPENDABLE_REQUEST.has(name.toLowerCase())) {
      problems.push({ profileId: profile.id, headerId: h.id,
        message: `"${name}": browsers only allow appending to a few request headers, so it is set instead` });
      op = 'set';
    }
    const info = { header: name, operation: op };
    if (op !== 'remove') info.value = h.value;
    return info;
  }

  // Later rows win over earlier rows with the same name (except appends, which add up).
  function dedupe(list) {
    const out = [];
    const seen = new Map();
    for (const info of list) {
      const key = info.header.toLowerCase();
      if (info.operation === 'append') { out.push(info); continue; }
      if (seen.has(key)) out[seen.get(key)] = null;
      seen.set(key, out.length);
      out.push(info);
    }
    return out.filter(Boolean);
  }

  const DOMAIN_KEYS = ['requestDomains', 'initiatorDomains'];
  const intersect = (a, b) => a.filter((x) => b.includes(x));
  /**
   * The condition matching requests that match both a and b, or null when nothing can
   * (no common request type, method or tab), or false when DNR cannot express it.
   */
  function combine(a, b) {
    if ((a.urlFilter || a.regexFilter) && (b.urlFilter || b.regexFilter)) return false;
    const c = Object.assign({}, a, b);
    c.resourceTypes = intersect(a.resourceTypes, b.resourceTypes);
    if (!c.resourceTypes.length) return null;
    if (a.requestMethods && b.requestMethods) {
      c.requestMethods = intersect(a.requestMethods, b.requestMethods);
      if (!c.requestMethods.length) return null;
    }
    if (a.tabIds && b.tabIds) {
      c.tabIds = intersect(a.tabIds, b.tabIds);
      if (!c.tabIds.length) return null;
    }
    for (const k of DOMAIN_KEYS) {
      // Lists match subdomains too, so only identical lists combine safely.
      if (a[k] && b[k] && a[k].join() !== b[k].join()) return false;
    }
    for (const k of ['excludedRequestDomains', 'excludedInitiatorDomains']) {
      const all = [...new Set([].concat(a[k] || [], b[k] || []))];
      if (all.length) c[k] = all; else delete c[k];
    }
    return c;
  }

  /**
   * Compile state into DNR rules.
   * opts.now: timestamp (ms); opts.resourceTypes: types the browser supports.
   * opts.emptyValues: false when the browser rejects set/append with an empty value (Firefox).
   * Returns { dynamic, session, problems, nextExpiry, liveCount }.
   * Profiles higher in the list get higher priority, so they win when two set the same header.
   */
  function compile(state, opts) {
    opts = opts || {};
    const now = opts.now == null ? Date.now() : opts.now;
    const supported = (opts.resourceTypes || RESOURCE_TYPES).filter((t) => RESOURCE_TYPES.includes(t));
    const out = { dynamic: [], session: [], problems: [], nextExpiry: null, liveCount: 0 };
    let nextId = 1;

    for (const p of state.profiles) {
      for (const h of p.headers) {
        const prob = h.enabled && h.name.trim() ? headerProblem(h) : '';
        if (prob) out.problems.push({ profileId: p.id, headerId: h.id, message: `"${h.name.trim()}": ${prob}` });
      }
      for (const f of p.filters) {
        const prob = f.enabled ? filterProblem(f) : '';
        if (prob) out.problems.push({ profileId: p.id, filterId: f.id, message: `filter "${f.value.trim()}": ${prob}` });
      }
      for (const c of p.cookies || []) {
        const prob = c.enabled && c.name.trim() ? cookieProblem(c) : '';
        if (prob) out.problems.push({ profileId: p.id, cookieId: c.id, message: `cookie "${c.name.trim()}": ${prob}` });
      }
      for (const r of p.redirects) {
        const prob = r.enabled ? redirectProblem(r) : '';
        if (prob) out.problems.push({ profileId: p.id, redirectId: r.id, message: `redirect "${r.from.trim()}": ${prob}` });
      }
    }
    if (state.paused) return out;

    const active = state.profiles.filter((p) => p.active);
    // First work out each profile's rules, then give them priorities from the bottom up.
    const built = [];
    active.forEach((p) => {
      let live = liveHeaders(p, now);
      // Firefox rejects a whole rule if one header is set to an empty value, which would
      // switch off every other header in the profile; skip just that row instead.
      if (opts.emptyValues === false) {
        live = live.filter((h) => {
          if (h.op === 'remove' || h.value !== '') return true;
          out.problems.push({ profileId: p.id, headerId: h.id,
            message: `"${h.name.trim()}": this browser cannot send an empty value, so the row is skipped (use remove to drop the header)` });
          return false;
        });
      }
      for (const h of p.headers) {
        if (h.enabled && h.expiresAt && h.expiresAt > now && (out.nextExpiry == null || h.expiresAt < out.nextExpiry)) {
          out.nextExpiry = h.expiresAt;
        }
      }
      const redirects = liveRedirects(p);
      const cookies = liveCookies(p);
      if (!live.length && !redirects.length && !cookies.length) return;
      out.liveCount += live.length + redirects.length + cookies.length;
      const requestHeaders = withCookies(dedupe(live.filter((h) => h.target === 'request').map((h) => headerInfo(h, out.problems, p))),
        cookies.filter((c) => c.target === 'request').map((c) => cookieInfo(c).value));
      const responseHeaders = dedupe(live.filter((h) => h.target === 'response').map((h) => headerInfo(h, out.problems, p))
        .concat(cookies.filter((c) => c.target === 'response').map(cookieInfo)));
      const action = { type: 'modifyHeaders' };
      if (requestHeaders.length) action.requestHeaders = requestHeaders;
      if (responseHeaders.length) action.responseHeaders = responseHeaders;

      const filters = p.filters.filter((f) => f.enabled && f.value.trim() && !filterProblem(f));
      const inc = filters.filter((f) => f.kind === 'include');
      const exc = filters.filter((f) => f.kind === 'exclude');
      const types = p.resourceTypes.length ? p.resourceTypes.filter((t) => supported.includes(t)) : supported;
      const base = { resourceTypes: types.length ? types : supported };
      const domains = (list, type) => list.filter((f) => f.type === type).map((f) => f.value.trim().toLowerCase());
      if (domains(exc, 'domain').length) base.excludedRequestDomains = domains(exc, 'domain');
      // "Page domain" filters match the page that made the request (its initiator), so
      // they narrow every other condition rather than adding alternatives.
      if (domains(inc, 'initiator').length) base.initiatorDomains = domains(inc, 'initiator');
      if (domains(exc, 'initiator').length) base.excludedInitiatorDomains = domains(exc, 'initiator');
      if (p.tabId != null) base.tabIds = [p.tabId];
      if (p.requestMethods.length) base.requestMethods = p.requestMethods.slice();

      const conditions = [];
      if (domains(inc, 'domain').length) conditions.push({ requestDomains: domains(inc, 'domain') });
      for (const f of inc) {
        if (f.type === 'regex') conditions.push({ regexFilter: f.value.trim() });
        if (f.type === 'pattern') conditions.push({ urlFilter: f.value.trim() });
      }
      if (!conditions.length) conditions.push({});

      const mods = (requestHeaders.length || responseHeaders.length)
        ? conditions.map((c) => ({ action, condition: Object.assign({}, base, c) })) : [];
      // Redirects carry their own URL match, so "Only on" filters do not narrow them;
      // exclusions, the tab, request types and methods still do.
      const redirs = redirects.map((r) => {
        const { regexFilter, regexSubstitution } = redirectAction(r);
        return { action: { type: 'redirect', redirect: { regexSubstitution } }, condition: Object.assign({}, base, { regexFilter }) };
      });
      // URL-level exclusions become "allow" rules one step above this profile.
      const allows = exc.filter((f) => f.type === 'pattern' || f.type === 'regex').map((f) => {
        const c = Object.assign({}, base, f.type === 'regex' ? { regexFilter: f.value.trim() } : { urlFilter: f.value.trim() });
        delete c.excludedRequestDomains;
        return { action: { type: 'allow' }, condition: c, label: f.value.trim() };
      });
      built.push({ p, mods, redirs, allows });
    });

    // An "allow" rule switches off every rule below it, not just its own profile's. So
    // for each profile with URL exclusions, the profiles below it get copies of their
    // header rules, limited to the excluded URLs and placed just above the allow rule.
    // Copies are only possible where the two conditions can be combined into one.
    const push = (r, priority) => {
      const rule = { id: nextId++, priority, action: r.action, condition: r.condition };
      (r.condition.tabIds ? out.session : out.dynamic).push(rule);
    };
    let cur = 1;
    for (let i = built.length - 1; i >= 0; i--) {
      const b = built[i];
      const priority = cur;
      b.mods.forEach((r) => push(r, priority));
      b.redirs.forEach((r) => push(r, priority));
      b.allows.forEach((r) => push(r, priority + 1));
      cur = priority + 2;
      if (!b.allows.length) continue;
      for (let j = built.length - 1; j > i; j--) {
        const lower = built[j];
        const copies = [];
        const urls = b.allows.map((a) => a.label).join(', ');
        const warn = (text) => out.problems.push({ profileId: lower.p.id, message: `"${b.p.name}" has a "Never on" URL filter (${urls}), ` +
          `and browsers then skip the profiles below it on those URLs too. ${text}` });
        if (lower.allows.length) {
          warn(`"${lower.p.name}" also has "Never on" URL filters, so it cannot be kept on there. Use a Domain exclusion in one of the two profiles.`);
          continue;
        }
        let combinable = true;
        for (const r of lower.mods) {
          for (const a of b.allows) {
            const c = combine(r.condition, a.condition);
            if (c === false) combinable = false;
            else if (c) copies.push({ action: r.action, condition: c });
          }
        }
        if (!combinable) {
          warn(`"${lower.p.name}" has "Only on" URL filters, so it cannot be kept on there. Move "${b.p.name}" below "${lower.p.name}", or use a Domain exclusion.`);
          continue;
        }
        if (lower.redirs.length) {
          warn(`"${lower.p.name}" keeps its headers there, but its redirects stay off. Move "${b.p.name}" below "${lower.p.name}" to keep them.`);
        }
        if (copies.length) { copies.forEach((r) => push(r, cur)); cur++; }
      }
    }
    return out;
  }

  root.HeaderDial = Object.assign(root.HeaderDial || {}, {
    SCHEMA, RESOURCE_TYPES, METHODS, APPENDABLE_REQUEST, COLORS, OPS, REDIRECT_MODES, uid, newHeader, newFilter,
    newRedirect, newCookie, newProfile, normalizeCookie, cookieProblem, cookieInfo, liveCookies, defaultState, normalizeState, normalizeProfile, normalizeHeader, normalizeFilter,
    normalizeRedirect, combine, headerProblem, filterProblem, redirectProblem, redirectAction, liveHeaders,
    compile,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HeaderDial;
})(typeof self !== 'undefined' ? self : globalThis);
