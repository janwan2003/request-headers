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
    for (const k of ['cookieHeaders', 'setCookieHeaders', 'urlReplacements']) {
      if (Array.isArray(m[k]) && m[k].length) note(`${k} (${m[k].length}) are not supported yet and were skipped`);
    }
    const p = HD.newProfile(i, { name, headers, filters, resourceTypes: [...types].filter((t) => HD.RESOURCE_TYPES.includes(t)) });
    if (typeof m.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(m.backgroundColor)) p.color = m.backgroundColor;
    if (!headers.length) note('no headers');
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
    if (/^https?:\/\//i.test(t)) {
      const m = t.match(/#p=([A-Za-z0-9_-]+)/);
      if (!m) throw new Error('This link has no HeaderDial profile in it.');
      try { t = b64urlDecode(m[1]); } catch (e) { throw new Error('This share link is damaged.'); }
    }
    let data;
    try { data = JSON.parse(t); } catch (e) { throw new Error('This is not valid JSON: ' + e.message); }
    const warnings = [];
    if (data && data.format === FORMAT && Array.isArray(data.profiles)) {
      const profiles = data.profiles.map((p, i) => HD.normalizeProfile(Object.assign({}, p, {
        id: null, tabId: null,
        headers: (p.headers || []).map((h) => Object.assign({}, h, { id: null, expiresAt: null })),
        filters: (p.filters || []).map((f) => Object.assign({}, f, { id: null })),
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
    throw new Error('Unrecognised format. Paste a HeaderDial export, a share link, or a ModHeader profile export.');
  }

  Object.assign(HD, { FORMAT, SHARE_BASE, exportJSON, shareLink, parseImport, b64urlEncode, b64urlDecode });
  if (typeof module !== 'undefined' && module.exports) module.exports = HD;
})(typeof self !== 'undefined' ? self : globalThis);
