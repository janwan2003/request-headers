// HeaderDial popup / full-page editor.
'use strict';
const HD = self.HeaderDial;
const api = typeof browser !== 'undefined' ? browser : chrome;
const $ = (id) => document.getElementById(id);
const IS_PAGE = new URLSearchParams(location.search).has('page');
if (IS_PAGE) document.body.classList.add('page');

let state = HD.defaultState();
let status = null;
let tab = null; // the tab the popup was opened over
let saveTimer = null;
let filtersOpen = null; // remembers whether the user opened or closed the filters section
let startHidden = false; // the user closed the first-run card

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

const selected = () => state.profiles.find((p) => p.id === state.selectedId) || state.profiles[0];

function save(rerender) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; api.storage.local.set({ state }); }, 250);
  if (rerender) render();
}
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  return api.storage.local.set({ state });
}

function fmtLeft(ms) {
  if (ms <= 0) return 'expired';
  const m = Math.ceil(ms / 60000);
  if (m < 60) return m + 'm left';
  const h = Math.floor(m / 60);
  return h < 48 ? h + 'h ' + (m % 60) + 'm left' : Math.round(h / 24) + 'd left';
}

const TIMERS = [['', 'No expiry'], ['900000', '15 min'], ['3600000', '1 hour'], ['28800000', '8 hours'], ['86400000', '1 day']];

function headerRow(p, h) {
  const now = Date.now();
  const expired = h.expiresAt && h.expiresAt <= now;
  const prob = h.enabled && h.name.trim() ? HD.headerProblem(h) : '';
  const row = el('div', { class: 'hrow' + (h.enabled ? '' : ' disabled') + (expired ? ' expired' : '') + (prob ? ' bad' : ''), dataset: { id: h.id } });
  const timer = el('select', { 'aria-label': 'Expiry', title: 'Turn this header off automatically after a while',
    onchange: (e) => {
      if (e.target.value === 'keep') return;
      h.expiresAt = e.target.value ? Date.now() + Number(e.target.value) : null;
      if (h.expiresAt) h.enabled = true;
      save(true);
    } });
  if (h.expiresAt) timer.append(el('option', { value: 'keep', selected: true }, '⏱ ' + fmtLeft(h.expiresAt - now).replace(' left', '')));
  for (const [v, label] of TIMERS) timer.append(el('option', { value: v, selected: !h.expiresAt && v === '' }, label));
  row.append(
    el('input', { type: 'checkbox', checked: h.enabled, 'aria-label': 'Enabled', title: 'Enabled',
      onchange: (e) => { h.enabled = e.target.checked; if (h.enabled && expired) h.expiresAt = null; save(true); } }),
    el('input', { type: 'text', class: 'name', value: h.name, placeholder: 'Header name', list: 'header-names',
      spellcheck: false, 'aria-label': 'Header name', title: prob || '',
      oninput: (e) => {
        h.name = e.target.value; save();
        const bad = h.enabled && h.name.trim() ? HD.headerProblem(h) : '';
        row.classList.toggle('bad', !!bad); e.target.title = bad;
      } }),
    el('input', { type: 'text', class: 'value', value: h.op === 'remove' ? '' : h.value,
      placeholder: h.op === 'remove' ? '(removed)' : 'Value', disabled: h.op === 'remove', spellcheck: false,
      'aria-label': 'Header value', oninput: (e) => { h.value = e.target.value; save(); } }),
    el('select', { 'aria-label': 'Operation', onchange: (e) => { h.op = e.target.value; save(true); } },
      ...HD.OPS.map((o) => el('option', { value: o, selected: h.op === o }, o))),
    timer,
    el('button', { class: 'icon', type: 'button', title: 'Delete', 'aria-label': 'Delete header',
      onclick: () => { p.headers = p.headers.filter((x) => x !== h); save(true); } }, '×'),
  );
  return row;
}

function filterRow(p, f) {
  const prob = f.enabled ? HD.filterProblem(f) : '';
  const ph = { pattern: '||api.example.com^ or */v1/*', regex: '^https://.*\\.example\\.com/', domain: 'example.com', initiator: 'localhost (the page making the request)' }[f.type];
  return el('div', { class: 'frow' + (prob ? ' bad' : ''), dataset: { id: f.id } },
    el('input', { type: 'checkbox', checked: f.enabled, 'aria-label': 'Enabled', onchange: (e) => { f.enabled = e.target.checked; save(true); } }),
    el('select', { 'aria-label': 'Include or exclude', onchange: (e) => { f.kind = e.target.value; save(true); } },
      el('option', { value: 'include', selected: f.kind === 'include' }, 'Only on'),
      el('option', { value: 'exclude', selected: f.kind === 'exclude' }, 'Never on')),
    el('select', { 'aria-label': 'Filter type', onchange: (e) => { f.type = e.target.value; save(true); } },
      el('option', { value: 'pattern', selected: f.type === 'pattern' }, 'URL pattern'),
      el('option', { value: 'regex', selected: f.type === 'regex' }, 'URL regex'),
      el('option', { value: 'domain', selected: f.type === 'domain' }, 'Domain'),
      el('option', { value: 'initiator', selected: f.type === 'initiator', title: 'The site of the page that made the request' }, 'Page domain')),
    el('input', { type: 'text', class: 'val', value: f.value, placeholder: ph, spellcheck: false, title: prob || '',
      'aria-label': 'Filter value', oninput: (e) => {
        f.value = e.target.value; save();
        const bad = f.enabled ? HD.filterProblem(f) : '';
        e.target.closest('.frow').classList.toggle('bad', !!bad); e.target.title = bad;
      } }),
    el('button', { class: 'icon', type: 'button', title: 'Delete', 'aria-label': 'Delete filter',
      onclick: () => { p.filters = p.filters.filter((x) => x !== f); save(true); } }, '×'));
}

function redirectRow(p, r) {
  const prob = r.enabled ? HD.redirectProblem(r) : '';
  const row = el('div', { class: 'rrow' + (r.enabled ? '' : ' disabled') + (prob ? ' bad' : ''), dataset: { id: r.id } });
  const check = () => {
    const bad = r.enabled ? HD.redirectProblem(r) : '';
    row.classList.toggle('bad', !!bad); row.querySelector('input.from').title = bad;
  };
  const regex = r.mode === 'regex';
  row.append(
    el('input', { type: 'checkbox', checked: r.enabled, 'aria-label': 'Enabled', title: 'Enabled',
      onchange: (e) => { r.enabled = e.target.checked; save(true); } }),
    el('select', { 'aria-label': 'Redirect type', title: 'Replace: swap this text in the URL. Regex: a regular expression, with \\1 for groups in the target.',
      onchange: (e) => { r.mode = e.target.value; save(true); } },
      el('option', { value: 'replace', selected: !regex }, 'Replace'),
      el('option', { value: 'regex', selected: regex }, 'Regex')),
    el('input', { type: 'text', class: 'from', value: r.from, spellcheck: false, title: prob || '', 'aria-label': 'URL to redirect',
      placeholder: regex ? '^https://prod\\.example\\.com/(.*)' : 'https://cdn.example.com/app/',
      oninput: (e) => { r.from = e.target.value; save(); check(); } }),
    el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
    el('input', { type: 'text', class: 'to', value: r.to, spellcheck: false, 'aria-label': 'Redirect to',
      placeholder: regex ? 'https://staging.example.com/\\1' : 'http://localhost:3000/',
      oninput: (e) => { r.to = e.target.value; save(); check(); } }),
    el('button', { class: 'icon', type: 'button', title: 'Delete', 'aria-label': 'Delete redirect',
      onclick: () => { p.redirects = p.redirects.filter((x) => x !== r); save(true); } }, '×'));
  return row;
}

function cookieRow(p, c) {
  const prob = c.enabled && c.name.trim() ? HD.cookieProblem(c) : '';
  const row = el('div', { class: 'crow' + (c.enabled ? '' : ' disabled') + (prob ? ' bad' : ''), dataset: { id: c.id } });
  const check = () => {
    const bad = c.enabled && c.name.trim() ? HD.cookieProblem(c) : '';
    row.classList.toggle('bad', !!bad); row.querySelector('input.name').title = bad;
  };
  const res = c.target === 'response';
  row.append(
    el('input', { type: 'checkbox', checked: c.enabled, 'aria-label': 'Enabled', title: 'Enabled',
      onchange: (e) => { c.enabled = e.target.checked; save(true); } }),
    el('select', { 'aria-label': 'Cookie direction',
      title: 'Send: add the cookie to requests. Store: make the browser save it, as if the server had sent Set-Cookie.',
      onchange: (e) => { c.target = e.target.value; if (c.target === 'response' && !c.attrs) c.attrs = 'Path=/'; save(true); } },
      el('option', { value: 'request', selected: !res }, 'Send'),
      el('option', { value: 'response', selected: res }, 'Store')),
    el('input', { type: 'text', class: 'name', value: c.name, placeholder: 'Cookie name', spellcheck: false,
      title: prob || '', 'aria-label': 'Cookie name', oninput: (e) => { c.name = e.target.value; save(); check(); } }),
    el('span', { class: 'arrow', 'aria-hidden': 'true' }, '='),
    el('input', { type: 'text', class: 'value', value: c.value, placeholder: 'Value', spellcheck: false,
      'aria-label': 'Cookie value', oninput: (e) => { c.value = e.target.value; save(); check(); } }),
    // row.append is the DOM method, which would print "false"; pass '' when there is no field.
    !res ? '' : el('input', { type: 'text', class: 'attrs', value: c.attrs, placeholder: 'Path=/; Max-Age=3600', spellcheck: false,
      'aria-label': 'Cookie attributes', title: 'Set-Cookie attributes, e.g. Path=/; Max-Age=3600; Secure',
      oninput: (e) => { c.attrs = e.target.value; save(); check(); } }),
    el('button', { class: 'icon', type: 'button', title: 'Delete', 'aria-label': 'Delete cookie',
      onclick: () => { p.cookies = p.cookies.filter((x) => x !== c); save(true); } }, '×'));
  return row;
}

function renderProfiles() {
  const nav = $('profiles');
  nav.replaceChildren(...state.profiles.map((p) => el('button', {
    class: 'chip' + (p.active ? '' : ' off'), type: 'button', 'aria-current': String(p.id === state.selectedId),
    title: p.active ? 'Active' : 'Inactive', onclick: () => { state.selectedId = p.id; save(true); },
  }, el('span', { class: 'dot', style: `background:${p.color};color:${p.color}` }), p.name || 'Untitled',
  p.tabId != null ? ' ⧉' : '')),
  el('button', { class: 'icon', type: 'button', title: 'New profile', 'aria-label': 'New profile',
    onclick: () => { const p = HD.newProfile(state.profiles.length); state.profiles.push(p); state.selectedId = p.id; save(true); } }, '+'));
}

function closeMenus() { document.querySelectorAll('.menu-list').forEach((m) => m.remove()); }

function profileMenu(p, anchor) {
  closeMenus();
  const idx = state.profiles.indexOf(p);
  const item = (label, fn, cls) => el('button', { type: 'button', class: cls || '', onclick: () => { closeMenus(); fn(); } }, label);
  const list = el('div', { class: 'menu-list', role: 'menu' },
    item('Duplicate', () => {
      const copy = HD.normalizeProfile(JSON.parse(JSON.stringify(Object.assign({}, p, { id: null, name: p.name + ' copy', tabId: null,
        headers: p.headers.map((h) => Object.assign({}, h, { id: null })), cookies: p.cookies.map((c) => Object.assign({}, c, { id: null })), redirects: p.redirects.map((r) => Object.assign({}, r, { id: null })), filters: p.filters.map((f) => Object.assign({}, f, { id: null })) }))), state.profiles.length);
      state.profiles.splice(idx + 1, 0, copy); state.selectedId = copy.id; save(true);
    }),
    idx > 0 && item('Move left (higher priority)', () => { state.profiles.splice(idx, 1); state.profiles.splice(idx - 1, 0, p); save(true); }),
    idx < state.profiles.length - 1 && item('Move right', () => { state.profiles.splice(idx, 1); state.profiles.splice(idx + 1, 0, p); save(true); }),
    item('Share as link…', () => openShare(p)),
    item('Copy as curl…', () => openCurl(p)),
    item('Export this profile', () => download(HD.exportJSON([p]), slug(p.name) + '.headerdial.json')),
    state.profiles.length > 1 && item('Delete profile', () => {
      if (!confirm(`Delete "${p.name}"?`)) return;
      state.profiles.splice(idx, 1); state.selectedId = state.profiles[Math.max(0, idx - 1)].id; save(true);
    }, 'danger'));
  anchor.parentElement.append(list);
  setTimeout(() => document.addEventListener('click', closeMenus, { once: true }), 0);
}

function renderEditor() {
  const p = selected();
  const main = $('editor');
  const req = p.headers.filter((h) => h.target === 'request');
  const res = p.headers.filter((h) => h.target === 'response');
  const menuBtn = el('button', { class: 'icon', type: 'button', title: 'Profile actions', 'aria-label': 'Profile actions',
    onclick: (e) => { e.stopPropagation(); profileMenu(p, menuBtn); } }, '⋯');
  const tabOnly = el('label', { class: 'hint', style: 'display:flex;gap:6px;align-items:center' },
    el('input', { type: 'checkbox', checked: p.tabId != null, disabled: !tab && p.tabId == null,
      onchange: (e) => {
        if (e.target.checked && tab) { p.tabId = tab.id; p.tabLabel = tab.title || tab.url || 'this tab'; p.active = true; }
        else { p.tabId = null; p.tabLabel = ''; }
        save(true);
      } }),
    p.tabId != null ? `Only in one tab: ${p.tabLabel}` + (tab && tab.id === p.tabId ? ' (this tab)' : '') : 'Only in this tab (until it closes)');
  const types = el('div', { class: 'types' }, ...HD.RESOURCE_TYPES.map((t) => el('label', {},
    el('input', { type: 'checkbox', checked: p.resourceTypes.includes(t), onchange: (e) => {
      p.resourceTypes = e.target.checked ? p.resourceTypes.concat(t) : p.resourceTypes.filter((x) => x !== t); save(true);
    } }), ' ', t.replace('_', ' '))));
  const methods = el('div', { class: 'types methods' }, ...HD.METHODS.map((m) => el('label', {},
    el('input', { type: 'checkbox', checked: p.requestMethods.includes(m), onchange: (e) => {
      p.requestMethods = e.target.checked ? p.requestMethods.concat(m) : p.requestMethods.filter((x) => x !== m); save(true);
    } }), ' ', m.toUpperCase())));
  const nFilters = p.filters.filter((f) => f.enabled && f.value.trim()).length + (p.tabId != null ? 1 : 0) +
    (p.resourceTypes.length ? 1 : 0) + (p.requestMethods.length ? 1 : 0);
  const det = el('details', { open: (filtersOpen == null ? nFilters > 0 : filtersOpen) || null,
    ontoggle: (e) => { filtersOpen = e.target.open; } },
    el('summary', {}, nFilters ? `Where it applies (${nFilters} filter${nFilters > 1 ? 's' : ''})` : 'Where it applies: all sites'),
    el('div', { class: 'rows' }, ...p.filters.map((f) => filterRow(p, f))),
    el('div', { class: 'add' },
      el('button', { type: 'button', onclick: () => { p.filters.push(HD.newFilter('include')); save(true); } }, '+ Only on…'),
      el('button', { type: 'button', onclick: () => { p.filters.push(HD.newFilter('exclude')); save(true); } }, '+ Never on…'),
      tab && tab.url && /^https?:/.test(tab.url) && el('button', { type: 'button', onclick: () => {
        p.filters.push(HD.newFilter('include', { type: 'domain', value: new URL(tab.url).hostname })); save(true);
      } }, '+ Only on ' + new URL(tab.url).hostname)),
    el('p', { class: 'hint' }, 'Pattern: ', el('code', {}, '||example.com^'), ' matches a domain and its subdomains, ',
      el('code', {}, '*'), ' is a wildcard. With no "Only on" filter the profile applies everywhere. ',
      el('b', {}, 'Page domain'), ' matches requests made by pages on that site (its fetches, scripts, images and the links it opens), not addresses you type.'),
    tabOnly,
    el('p', { class: 'hint' }, 'Request types (none ticked = all, including page loads):'), types,
    el('p', { class: 'hint' }, 'Methods (none ticked = all). CORS preflights are OPTIONS requests:'), methods);
  const addCookieBtn = el('button', { type: 'button', id: 'add-cookie', onclick: () => addCookie(p) }, '+ Cookie');
  const addRedirBtn = el('button', { type: 'button', id: 'add-redir', onclick: () => addRedirect(p) }, '+ URL redirect');
  main.replaceChildren(
    el('div', { class: 'pbar' },
      el('input', { type: 'color', value: p.color, title: 'Profile colour', 'aria-label': 'Profile colour',
        oninput: (e) => { p.color = e.target.value; save(); renderProfiles(); } }),
      el('input', { type: 'text', class: 'pname', value: p.name, 'aria-label': 'Profile name',
        oninput: (e) => { p.name = e.target.value; save(); renderProfiles(); } }),
      el('label', { class: 'switch', title: 'Turn this profile on or off' },
        el('input', { type: 'checkbox', id: 'profile-active', checked: p.active, onchange: (e) => { p.active = e.target.checked; save(true); } }),
        el('span', { class: 'track' }), p.active ? 'Active' : 'Off'),
      el('span', { class: 'menu' }, menuBtn)),
    ...(isFresh(p) ? [startCard(p)] : []), // replaceChildren would print a false
    el('h3', {}, 'Request headers'),
    el('div', { class: 'rows', id: 'req-rows' }, req.length ? req.map((h) => headerRow(p, h)) : el('div', { class: 'empty' }, 'None.')),
    el('div', { class: 'add' }, el('button', { type: 'button', id: 'add-req', onclick: () => addHeader(p, 'request') }, '+ Request header'),
      el('select', { id: 'recipe', class: 'recipe', 'aria-label': 'Add from a recipe', title: 'Add common headers in one click',
        onchange: (e) => { const k = e.target.value; e.target.value = ''; if (k) addRecipe(p, k); } },
      el('option', { value: '' }, '+ Recipe…'), ...HD.RECIPES.map((r) => el('option', { value: r.key }, r.label)))),
    el('h3', {}, 'Response headers'),
    el('div', { class: 'rows', id: 'res-rows' }, res.length ? res.map((h) => headerRow(p, h)) : el('div', { class: 'empty' }, 'None.')),
    // Cookie and redirect buttons sit next to "+ Response header" until the profile has such rows,
    // then below their own section; keeps a fresh popup under the browsers' 600px popup height.
    el('div', { class: 'add' }, el('button', { type: 'button', id: 'add-res', onclick: () => addHeader(p, 'response') }, '+ Response header'),
      ...(p.cookies.length ? [] : [addCookieBtn]), ...(p.redirects.length ? [] : [addRedirBtn])),
    ...(p.cookies.length ? [
      el('h3', {}, 'Cookies'),
      el('div', { class: 'rows', id: 'cookie-rows' }, p.cookies.map((c) => cookieRow(p, c))),
      el('p', { class: 'hint' }, 'Send adds name=value after the cookies the browser sends. If it already has one with that name, the server gets both, ',
        'the browser\'s first. Store saves the cookie in the browser, as Set-Cookie would, replacing one with the same name and path.'),
      el('div', { class: 'add' }, addCookieBtn),
    ] : []),
    ...(p.redirects.length ? [
      el('h3', {}, 'URL redirects'),
      el('div', { class: 'rows', id: 'redir-rows' }, p.redirects.map((r) => redirectRow(p, r))),
      el('p', { class: 'hint' }, 'Requests whose URL contains the text on the left go to the URL with that text replaced. ',
        '"Never on" filters, the tab, request types and methods below apply to redirects too.'),
      el('div', { class: 'add' }, addRedirBtn),
    ] : []),
    det);
}

// First run: one untouched profile. Offer the three ways people start: paste a request
// from DevTools, bring profiles over from ModHeader, or a one-click recipe.
const START_RECIPES = [['bearer', 'Bearer token'], ['cors', 'Allow CORS'], ['mobile', 'Mobile UA'],
  ['nocache', 'No cache'], ['iframe', 'Allow framing'], ['xff', 'X-Forwarded-For']];
function isFresh(p) {
  return !startHidden && state.profiles.length === 1 && !p.headers.some((h) => h.name.trim()) &&
    !p.cookies.length && !p.redirects.length && !p.filters.length;
}
function startCard(p) {
  const openImport = (hint) => {
    const msg = $('import-msg');
    msg.className = 'msg'; msg.textContent = hint || '';
    $('import-dialog').showModal();
    $('import-text').focus();
  };
  return el('section', { class: 'start', id: 'start', 'aria-label': 'Start here' },
    el('div', { class: 'start-head' }, el('strong', {}, 'Start here'), el('span', { class: 'spacer' }),
      el('button', { class: 'icon', type: 'button', id: 'start-close', title: 'Hide this', 'aria-label': 'Hide the start card',
        onclick: () => { startHidden = true; api.storage.local.set({ startHidden: true }); renderEditor(); } }, '×')),
    el('div', { class: 'start-ways' },
      el('button', { type: 'button', id: 'start-paste', onclick: () => openImport() },
        el('b', {}, 'Paste a request'), el('span', {}, 'Copy as cURL or fetch in DevTools, paste it here, keep the headers you need')),
      el('button', { type: 'button', id: 'start-modheader', onclick: () => openImport(
        'From ModHeader: paste its exported JSON, or if ModHeader is disabled, choose the .ldb and .log files from its data folder.') },
        el('b', {}, 'Coming from ModHeader?'), el('span', {}, 'Import its export, or recover profiles from a disabled ModHeader'))),
    el('div', { class: 'start-recipes' }, el('span', { class: 'muted' }, 'One click:'),
      ...START_RECIPES.map(([k, label]) => el('button', { type: 'button', dataset: { recipe: k }, onclick: () => addRecipe(p, k) }, label))));
}

function addHeader(p, target) {
  const h = HD.newHeader(target);
  p.headers.push(h);
  save(true);
  const input = document.querySelector(`[data-id="${h.id}"] input.name`);
  if (input) input.focus();
}

function addRecipe(p, key) {
  const origin = tab && tab.url && /^https?:/.test(tab.url) ? new URL(tab.url).origin : null;
  const focus = HD.applyRecipe(p, key, { origin });
  save(true);
  const input = focus && document.querySelector(`[data-id="${focus}"] input.value`);
  if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
}

function addCookie(p) {
  const c = HD.newCookie('request');
  p.cookies.push(c);
  save(true);
  const input = document.querySelector(`[data-id="${c.id}"] input.name`);
  if (input) input.focus();
}

function addRedirect(p) {
  const r = HD.newRedirect();
  p.redirects.push(r);
  save(true);
  const input = document.querySelector(`[data-id="${r.id}"] input.from`);
  if (input) input.focus();
}

function renderProblems() {
  const ul = $('problems');
  const list = (status && status.problems) || [];
  ul.hidden = !list.length;
  ul.replaceChildren(...list.map((p) => {
    const prof = p.profileId && state.profiles.find((x) => x.id === p.profileId);
    return el('li', {}, (prof && state.profiles.length > 1 ? prof.name + ': ' : '') + p.message);
  }));
}

function render() {
  $('power').checked = !state.paused;
  $('power-label').textContent = state.paused ? 'Paused' : 'On';
  renderProfiles();
  renderEditor();
  renderProblems();
}

async function renderAccess() {
  const box = $('access');
  if (!api.permissions) { box.hidden = true; return; }
  const all = await api.permissions.contains({ origins: ['<all_urls>'] });
  if (all) { box.hidden = true; return; }
  const granted = ((await api.permissions.getAll()).origins || []).filter((o) => o !== '<all_urls>');
  const host = tab && tab.url && /^https?:/.test(tab.url) ? new URL(tab.url).origin : null;
  const hostGranted = host && (await api.permissions.contains({ origins: [host + '/*'] }));
  // Errors are shown in the banner: Firefox popups cannot show alert().
  const ask = (origins) => api.permissions.request({ origins }).then(renderAccess)
    .catch((e) => box.append(el('span', { class: 'msg err' }, ' ' + ((e && e.message) || e))));
  box.className = 'banner' + (granted.length ? ' info' : '');
  // replaceChildren is the DOM method (not el), so drop the missing "Only <host>" button.
  box.replaceChildren(...[
    el('span', {}, granted.length
      ? `Headers are changed on ${granted.length} site${granted.length > 1 ? 's' : ''} you allowed.`
      : 'HeaderDial needs your permission before it can change headers on websites.'),
    el('button', { type: 'button', class: granted.length ? '' : 'primary', onclick: () => ask(['<all_urls>']) }, 'Allow on all sites'),
    host && !hostGranted && el('button', { type: 'button', onclick: () => ask([host + '/*']) }, 'Only ' + new URL(host).host),
  ].filter(Boolean));
  box.hidden = false;
}

async function renderMatched() {
  const out = $('matched');
  if (!tab || !api.declarativeNetRequest.getMatchedRules) return;
  try {
    const { rulesMatchedInfo } = await api.declarativeNetRequest.getMatchedRules({ tabId: tab.id });
    const n = rulesMatchedInfo.length;
    out.textContent = n ? `Applied to ${n} request${n > 1 ? 's' : ''} in this tab` : 'Not applied in this tab yet';
    out.title = 'Requests in this tab where a header rule applied (last 5 minutes, since you opened HeaderDial here)';
  } catch (e) { out.textContent = ''; }
}

function slug(s) { return String(s || 'profile').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'profile'; }

function download(text, name) {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove();
}

function openShare(p) {
  const d = $('share-dialog');
  const upd = () => { $('share-text').value = HD.shareLink(p, { blankValues: $('share-blank').checked }); $('share-msg').textContent = ''; };
  $('share-blank').onchange = upd;
  upd();
  d.showModal();
}

function openCurl(p) {
  const url = tab && tab.url && /^https?:/.test(tab.url) ? tab.url : 'https://example.com/';
  $('curl-text').value = HD.curlCommand(p, url);
  $('curl-msg').textContent = '';
  $('curl-dialog').showModal();
}

$('curl-copy').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await navigator.clipboard.writeText($('curl-text').value); } catch (_) { $('curl-text').select(); document.execCommand('copy'); }
  $('curl-msg').className = 'msg ok'; $('curl-msg').textContent = 'Copied.';
});

$('share-copy').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await navigator.clipboard.writeText($('share-text').value); } catch (_) { $('share-text').select(); document.execCommand('copy'); }
  $('share-msg').className = 'msg ok'; $('share-msg').textContent = 'Copied.';
});

$('import').addEventListener('click', () => { $('import-msg').textContent = ''; $('import-dialog').showModal(); });

// A request pasted from DevTools (curl, fetch, header lines): show what the profile will
// send, with the browser's own headers unticked, before importing.
let pasteReq = null, pasteFor = null;
const PASTE_WHAT = { curl: 'a curl command', fetch: 'a fetch() call', headers: 'header lines', 'JSON headers': 'a JSON object of headers' };
function renderPastePreview() {
  const box = $('import-preview');
  box.textContent = '';
  pasteReq = null;
  pasteFor = $('import-text').value;
  try { pasteReq = HD.parseRequestText($('import-text').value); } catch (_) { pasteReq = null; }
  box.hidden = !pasteReq;
  if (!pasteReq) return;
  const req = pasteReq;
  const short = (v) => (v.length > 70 ? v.slice(0, 70) + '…' : v);
  box.append(el('p', { class: 'muted' }, `Recognised ${PASTE_WHAT[req.source]}${req.host ? ' for ' + req.host : ''}. Tick what the new profile should send:`));
  box.append(el('ul', { class: 'pick' }, req.items.map((it) => el('li', {},
    el('label', { title: it.value },
      el('input', { type: 'checkbox', checked: it.keep, onchange: (e) => { it.keep = e.target.checked; } }),
      el('code', {}, (it.kind === 'cookie' ? 'Cookie ' + it.name + '=' : it.name + (it.remove ? ' (remove)' : ': ')) + (it.remove ? '' : short(it.value))),
      it.why ? el('span', { class: 'why' }, it.why) : null)))));
  if (req.host) {
    box.append(el('label', {}, el('input', { type: 'checkbox', id: 'import-onlyhost', checked: true }),
      ` Only on ${req.host} and its subdomains (Domain filter)`));
  }
  for (const n of req.notes) box.append(el('p', { class: 'muted' }, n));
}
let pasteTimer = null;
$('import-text').addEventListener('input', () => { clearTimeout(pasteTimer); pasteTimer = setTimeout(renderPastePreview, 120); });
$('import-file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  const msg = $('import-msg');
  msg.textContent = '';
  const db = files.filter((f) => /\.(ldb|log|sst)$/i.test(f.name));
  if (!db.length) { if (files[0]) { $('import-text').value = await files[0].text(); renderPastePreview(); } return; }
  // LevelDB files from a disabled ModHeader: read locally, keep the largest profile set.
  const input = await Promise.all(db.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
  const r = self.HeaderDialLevelDB.findModHeaderProfiles(input);
  if (!r.found.length) {
    msg.className = 'msg err';
    msg.textContent = `No ModHeader profiles in ${db.length} file${db.length > 1 ? 's' : ''}.` + (r.errors.length ? ' ' + r.errors.join('; ') : '');
    return;
  }
  $('import-text').value = JSON.stringify(r.found[0].profiles, null, 2);
  msg.className = 'msg ok';
  msg.textContent = `Found ${r.found[0].profiles.length} ModHeader profile${r.found[0].profiles.length > 1 ? 's' : ''}` +
    (r.found.length > 1 ? ` (and ${r.found.length - 1} other set${r.found.length > 2 ? 's' : ''}; use the recovery page to pick one)` : '') +
    '. Click Import.';
});
$('import-go').addEventListener('click', (e) => {
  e.preventDefault();
  const msg = $('import-msg');
  clearTimeout(pasteTimer);
  if ($('import-text').value !== pasteFor) renderPastePreview();
  try {
    let res;
    if (pasteReq) {
      const onlyHost = !!($('import-onlyhost') && $('import-onlyhost').checked);
      const p = HD.profileFromRequest(pasteReq, { onlyHost, index: state.profiles.length });
      if (!p.headers.length && !p.cookies.length) throw new Error('Tick at least one header or cookie to import.');
      res = { source: PASTE_WHAT[pasteReq.source], profiles: [p], warnings: [] };
      const n = p.headers.length + p.cookies.length;
      res.warnings.push(`${n} row${n > 1 ? 's' : ''}` + (p.filters.length ? `, only on ${pasteReq.host}.` : ', on every site (no Domain filter).'));
    } else res = HD.parseImport($('import-text').value);
    if ($('import-replace').checked) state.profiles = res.profiles;
    else state.profiles = state.profiles.concat(res.profiles);
    state.selectedId = res.profiles[0].id;
    saveNow(); render();
    msg.className = 'msg ok';
    msg.textContent = `Imported ${res.profiles.length} profile${res.profiles.length > 1 ? 's' : ''} from ${res.source}.` +
      (res.warnings.length ? '\n' + res.warnings.join('\n') : '');
    $('import-text').value = '';
    renderPastePreview();
  } catch (err) {
    msg.className = 'msg err'; msg.textContent = err.message;
  }
});
$('export').addEventListener('click', () => download(HD.exportJSON(state.profiles), 'headerdial-profiles.json'));
$('power').addEventListener('change', (e) => { state.paused = !e.target.checked; save(true); });
$('open-tab').addEventListener('click', () => { api.tabs.create({ url: api.runtime.getURL('popup.html?page=1') }); window.close(); });
if (IS_PAGE) $('open-tab').hidden = true;

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.status) { status = changes.status.newValue; renderProblems(); }
  // Another window edited the profiles: follow it unless we have unsaved typing.
  if (changes.state && !saveTimer && JSON.stringify(changes.state.newValue) !== JSON.stringify(state)) {
    state = HD.normalizeState(changes.state.newValue); render();
  }
});

(async function init() {
  const got = await api.storage.local.get(['state', 'status', 'startHidden']);
  state = HD.normalizeState(got.state);
  startHidden = !!got.startHidden;
  status = got.status || null;
  if (!got.state) await saveNow();
  if (!IS_PAGE) {
    try { [tab] = await api.tabs.query({ active: true, currentWindow: true }); } catch (e) { tab = null; }
  }
  render();
  renderAccess();
  renderMatched();
  // Keep expiry countdowns fresh while the editor is open.
  setInterval(() => { if (!document.activeElement || document.activeElement === document.body) renderEditor(); }, 30000);
})();
