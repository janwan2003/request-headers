// Import and export: HeaderDial's own JSON, share links, and profile exports from
// ModHeader (the JSON array of profiles that ModHeader's "Export" produced).
(function (root) {
  'use strict';
  const HD = root.HeaderDial || (typeof require === 'function' ? require('./model.js') : null);
  const FORMAT = 'headerdial';
  const SHARE_BASE = 'https://janwan2003.github.io/request-headers/share/';

  function stripProfile(p, opts) {
    const blank = opts && opts.blankValues;
    return {
      name: p.name, color: p.color, active: p.active,
      headers: p.headers.map((h) => ({ enabled: h.enabled, target: h.target, name: h.name,
        value: blank ? '' : h.value, op: h.op, comment: h.comment })),
      cookies: (p.cookies || []).map((c) => ({ enabled: c.enabled, target: c.target, name: c.name,
        value: blank ? '' : c.value, attrs: c.attrs })),
      redirects: (p.redirects || []).map((r) => ({ enabled: r.enabled, mode: r.mode, from: r.from, to: r.to })),
      filters: p.filters.map((f) => ({ enabled: f.enabled, kind: f.kind, type: f.type, value: f.value })),
      resourceTypes: p.resourceTypes.slice(),
      requestMethods: p.requestMethods.slice(),
    };
  }

  function exportJSON(profiles, opts) {
    return JSON.stringify({ format: FORMAT, version: 1, profiles: profiles.map((p) => stripProfile(p, opts)) }, null, 2);
  }

  function b64urlEncode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  function shareLink(profile, opts) {
    const json = JSON.stringify({ format: FORMAT, version: 1, profiles: [stripProfile(profile, opts)] });
    return SHARE_BASE + '#p=' + b64urlEncode(json);
  }

  // ModHeader profile -> HeaderDial profile. Unsupported parts become warnings.
  function fromModHeader(m, i, warnings) {
    const name = typeof m.title === 'string' && m.title ? m.title : 'Imported ' + (i + 1);
    const note = (msg) => warnings.push(`${name}: ${msg}`);
    const append = m.appendMode === true || m.appendMode === 'append';
    const rows = (list, target) => (Array.isArray(list) ? list : []).map((h) => {
      const value = typeof h.value === 'string' ? h.value : h.value == null ? '' : String(h.value);
      return HD.newHeader(target, {
        enabled: h.enabled !== false, name: String(h.name || ''), value,
        op: value === '' ? 'remove' : append ? 'append' : 'set', comment: String(h.comment || ''),
      });
    }).filter((h) => h.name);
    const headers = rows(m.headers, 'request').concat(rows(m.respHeaders, 'response'));
    const filters = [];
    const types = new Set();
    for (const f of Array.isArray(m.filters) ? m.filters : []) {
      if (Array.isArray(f.resourceType)) f.resourceType.forEach((t) => types.add(t));
      if (f.type === 'urls' || f.type === 'excludeUrls') {
        if (f.urlRegex) {
          filters.push(HD.newFilter(f.type === 'urls' ? 'include' : 'exclude',
            { type: 'regex', value: String(f.urlRegex), enabled: f.enabled !== false }));
        }
      } else if (f.type === 'resourceTypes') {
        // resource types are collected above
      } else if (f.type) {
        note(`filter type "${f.type}" is not supported and was skipped`);
      }
    }
    // ModHeader's URL replacements swap one piece of text in the URL for another,
    // which is HeaderDial's "replace" redirect.
    const redirects = (Array.isArray(m.urlReplacements) ? m.urlReplacements : [])
      .filter((u) => u && u.name)
      .map((u) => HD.newRedirect({ enabled: u.enabled !== false, from: String(u.name), to: String(u.value == null ? '' : u.value) }));
    // ModHeader's request cookies add name=value to the Cookie header; its response
    // cookies are Set-Cookie values, possibly with attributes after the first ";".
    const cookies = [];
    for (const [k, target] of [['cookieHeaders', 'request'], ['setCookieHeaders', 'response']]) {
      for (const c of Array.isArray(m[k]) ? m[k] : []) {
        if (!c || !c.name) continue;
        const raw = c.value == null ? '' : String(c.value);
        const cut = target === 'response' ? raw.indexOf(';') : -1;
        cookies.push(HD.newCookie(target, { enabled: c.enabled !== false, name: String(c.name).trim(),
          value: cut < 0 ? raw : raw.slice(0, cut).trim(), attrs: cut < 0 ? (target === 'response' ? 'Path=/' : '') : raw.slice(cut + 1).trim() }));
      }
    }
    const p = HD.newProfile(i, { name, headers, cookies, redirects, filters, resourceTypes: [...types].filter((t) => HD.RESOURCE_TYPES.includes(t)) });
    if (typeof m.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(m.backgroundColor)) p.color = m.backgroundColor;
    if (!headers.length && !redirects.length && !cookies.length) note('no headers');
    return HD.normalizeProfile(p, i);
  }

  function looksLikeModHeader(o) {
    return o && typeof o === 'object' && ('respHeaders' in o || 'shortTitle' in o || 'urlReplacements' in o ||
      'appendMode' in o || ('title' in o && 'headers' in o));
  }

  /**
   * Parse pasted text: HeaderDial JSON, a HeaderDial share link, or a ModHeader export.
   * Returns { source, profiles, warnings }; throws Error with a readable message.
   */
  function parseImport(text) {
    let t = String(text || '').trim();
    if (!t) throw new Error('Nothing to import.');
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) {
      const m = t.match(/#p=([A-Za-z0-9_-]+)/);
      if (!m) throw new Error('This link has no HeaderDial profile in it.');
      try { t = b64urlDecode(m[1]); } catch (e) { throw new Error('This share link is damaged.'); }
    }
    // A copied request (curl, fetch, raw header lines, a JSON object of headers).
    const req = HD.parseRequestText ? HD.parseRequestText(t) : null;
    if (req) {
      const p = HD.profileFromRequest(req);
      if (!p.headers.length && !p.cookies.length) throw new Error('Nothing to import: every header in it is one the browser sends itself.');
      return { source: req.source === 'curl' ? 'a curl command' : req.source === 'fetch' ? 'a fetch() call' : 'pasted headers',
        profiles: [p], warnings: req.notes.slice(), request: req };
    }
    let data;
    try { data = JSON.parse(t); } catch (e) {
      if (/^[[{]/.test(t)) throw new Error('This is not valid JSON: ' + e.message);
      throw new Error('Unrecognised format. Paste a HeaderDial export, a share link, a ModHeader profile export, a curl command, or header lines (Name: value).');
    }
    const warnings = [];
    if (data && data.format === FORMAT && Array.isArray(data.profiles)) {
      const profiles = data.profiles.map((p, i) => HD.normalizeProfile(Object.assign({}, p, {
        id: null, tabId: null,
        headers: (p.headers || []).map((h) => Object.assign({}, h, { id: null, expiresAt: null })),
        filters: (p.filters || []).map((f) => Object.assign({}, f, { id: null })),
        redirects: (p.redirects || []).map((r) => Object.assign({}, r, { id: null })),
        cookies: (p.cookies || []).map((c) => Object.assign({}, c, { id: null })),
      }), i));
      return { source: 'HeaderDial', profiles, warnings };
    }
    let list = null;
    if (Array.isArray(data)) list = data;
    else if (data && Array.isArray(data.profiles)) list = data.profiles;
    else if (looksLikeModHeader(data)) list = [data];
    if (list && list.length && list.every(looksLikeModHeader)) {
      return { source: 'ModHeader', profiles: list.map((m, i) => fromModHeader(m, i, warnings)), warnings };
    }
    throw new Error('Unrecognised format. Paste a HeaderDial export, a share link, a ModHeader profile export, a curl command, or header lines (Name: value).');
  }

  // Quote one argument for a POSIX shell.
  const shq = (t) => "'" + String(t).replace(/'/g, "'\\''") + "'";

  /**
   * A curl command that sends what this profile sends (request headers and cookies) to
   * url. Removed headers become -H 'Name:' (curl then drops its own copy). Response
   * changes and redirects are browser-side, so they are listed as comments.
   */
  function curlCommand(profile, url, opts) {
    const now = (opts && opts.now) || Date.now();
    const lines = [];
    const notes = [];
    for (const h of HD.liveHeaders(profile, now)) {
      if (h.target === 'response') { notes.push(`response header ${h.op} ${h.name.trim()}`); continue; }
      lines.push('-H ' + shq(h.op === 'remove' ? h.name.trim() + ':' : h.name.trim() + ': ' + h.value));
    }
    const sent = HD.liveCookies(profile).filter((c) => c.target === 'request').map((c) => c.name.trim() + '=' + c.value.trim());
    if (sent.length) lines.push('-b ' + shq(sent.join('; ')));
    for (const c of HD.liveCookies(profile)) if (c.target === 'response') notes.push(`response cookie ${c.name.trim()}`);
    for (const r of profile.redirects || []) if (r.enabled && r.from.trim()) notes.push(`redirect ${r.from.trim()} -> ${r.to.trim()}`);
    const cmd = ['curl ' + shq(url || 'https://example.com/')].concat(lines).join(' \\\n  ');
    return (notes.length ? notes.map((n) => '# not in curl (browser only): ' + n).join('\n') + '\n' : '') + cmd;
  }

  Object.assign(HD, { FORMAT, SHARE_BASE, exportJSON, curlCommand, shareLink, parseImport, b64urlEncode, b64urlDecode });
  if (typeof module !== 'undefined' && module.exports) module.exports = HD;
})(typeof self !== 'undefined' ? self : globalThis);
