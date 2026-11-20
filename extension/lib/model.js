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
  const FILTER_TYPES = ['pattern', 'regex', 'domain'];

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

  function newProfile(index, o) {
    const i = index || 0;
    return Object.assign({ id: uid(), name: 'Profile ' + (i + 1), color: COLORS[i % COLORS.length], active: true,
      headers: [newHeader('request')], filters: [], resourceTypes: [], requestMethods: [], tabId: null, tabLabel: '' }, o || {});
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

  function normalizeProfile(p, i) {
    p = p && typeof p === 'object' ? p : {};
    return {
      id: str(p.id, '') || uid(),
      name: str(p.name, '') || 'Profile ' + (i + 1),
      color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : COLORS[i % COLORS.length],
      active: bool(p.active, true),
      headers: Array.isArray(p.headers) ? p.headers.map(normalizeHeader) : [],
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

  function filterProblem(f) {
    const v = f.value.trim();
    if (!v) return '';
    if (f.type === 'regex') {
      try { new RegExp(v); } catch (e) { return 'invalid regular expression'; }
    }
    if (f.type === 'domain' && !/^[a-z0-9.-]+$/i.test(v)) return 'domain must look like example.com';
    return '';
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

  /**
   * Compile state into DNR rules.
   * opts.now: timestamp (ms); opts.resourceTypes: types the browser supports.
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
    }
    if (state.paused) return out;

    const active = state.profiles.filter((p) => p.active);
    active.forEach((p, idx) => {
      const live = liveHeaders(p, now);
      for (const h of p.headers) {
        if (h.enabled && h.expiresAt && h.expiresAt > now && (out.nextExpiry == null || h.expiresAt < out.nextExpiry)) {
          out.nextExpiry = h.expiresAt;
        }
      }
      if (!live.length) return;
      out.liveCount += live.length;
      const requestHeaders = dedupe(live.filter((h) => h.target === 'request').map((h) => headerInfo(h, out.problems, p)));
      const responseHeaders = dedupe(live.filter((h) => h.target === 'response').map((h) => headerInfo(h, out.problems, p)));
      const action = { type: 'modifyHeaders' };
      if (requestHeaders.length) action.requestHeaders = requestHeaders;
      if (responseHeaders.length) action.responseHeaders = responseHeaders;

      const filters = p.filters.filter((f) => f.enabled && f.value.trim() && !filterProblem(f));
      const inc = filters.filter((f) => f.kind === 'include');
      const exc = filters.filter((f) => f.kind === 'exclude');
      const types = p.resourceTypes.length ? p.resourceTypes.filter((t) => supported.includes(t)) : supported;
      const base = { resourceTypes: types.length ? types : supported };
      const excludedDomains = exc.filter((f) => f.type === 'domain').map((f) => f.value.trim().toLowerCase());
      if (excludedDomains.length) base.excludedRequestDomains = excludedDomains;
      if (p.tabId != null) base.tabIds = [p.tabId];
      if (p.requestMethods.length) base.requestMethods = p.requestMethods.slice();

      const conditions = [];
      const incDomains = inc.filter((f) => f.type === 'domain').map((f) => f.value.trim().toLowerCase());
      if (incDomains.length) conditions.push({ requestDomains: incDomains });
      for (const f of inc) {
        if (f.type === 'regex') conditions.push({ regexFilter: f.value.trim() });
        if (f.type === 'pattern') conditions.push({ urlFilter: f.value.trim() });
      }
      if (!conditions.length) conditions.push({});

      const target = p.tabId != null ? out.session : out.dynamic;
      const priority = (active.length - idx) * 2;
      for (const c of conditions) {
        target.push({ id: nextId++, priority, action, condition: Object.assign({}, base, c) });
      }
      // URL-level exclusions become "allow" rules one step above this profile.
      for (const f of exc) {
        if (f.type === 'domain') continue;
        const c = Object.assign({}, base, f.type === 'regex' ? { regexFilter: f.value.trim() } : { urlFilter: f.value.trim() });
        delete c.excludedRequestDomains;
        target.push({ id: nextId++, priority: priority + 1, action: { type: 'allow' }, condition: c });
      }
    });
    return out;
  }

  root.HeaderDial = Object.assign(root.HeaderDial || {}, {
    SCHEMA, RESOURCE_TYPES, METHODS, APPENDABLE_REQUEST, COLORS, OPS, uid, newHeader, newFilter, newProfile, defaultState,
    normalizeState, normalizeProfile, normalizeHeader, normalizeFilter, headerProblem, filterProblem, liveHeaders,
    compile,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HeaderDial;
})(typeof self !== 'undefined' ? self : globalThis);
