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
  const ph = { pattern: '||api.example.com^ or */v1/*', regex: '^https://.*\\.example\\.com/', domain: 'example.com' }[f.type];
  return el('div', { class: 'frow' + (prob ? ' bad' : ''), dataset: { id: f.id } },
    el('input', { type: 'checkbox', checked: f.enabled, 'aria-label': 'Enabled', onchange: (e) => { f.enabled = e.target.checked; save(true); } }),
    el('select', { 'aria-label': 'Include or exclude', onchange: (e) => { f.kind = e.target.value; save(true); } },
      el('option', { value: 'include', selected: f.kind === 'include' }, 'Only on'),
      el('option', { value: 'exclude', selected: f.kind === 'exclude' }, 'Never on')),
    el('select', { 'aria-label': 'Filter type', onchange: (e) => { f.type = e.target.value; save(true); } },
      el('option', { value: 'pattern', selected: f.type === 'pattern' }, 'URL pattern'),
      el('option', { value: 'regex', selected: f.type === 'regex' }, 'URL regex'),
      el('option', { value: 'domain', selected: f.type === 'domain' }, 'Domain')),
    el('input', { type: 'text', class: 'val', value: f.value, placeholder: ph, spellcheck: false, title: prob || '',
      'aria-label': 'Filter value', oninput: (e) => {
        f.value = e.target.value; save();
        const bad = f.enabled ? HD.filterProblem(f) : '';
        e.target.closest('.frow').classList.toggle('bad', !!bad); e.target.title = bad;
      } }),
    el('button', { class: 'icon', type: 'button', title: 'Delete', 'aria-label': 'Delete filter',
      onclick: () => { p.filters = p.filters.filter((x) => x !== f); save(true); } }, '×'));
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
        headers: p.headers.map((h) => Object.assign({}, h, { id: null })), filters: p.filters.map((f) => Object.assign({}, f, { id: null })) }))), state.profiles.length);
      state.profiles.splice(idx + 1, 0, copy); state.selectedId = copy.id; save(true);
    }),
    idx > 0 && item('Move left (higher priority)', () => { state.profiles.splice(idx, 1); state.profiles.splice(idx - 1, 0, p); save(true); }),
    idx < state.profiles.length - 1 && item('Move right', () => { state.profiles.splice(idx, 1); state.profiles.splice(idx + 1, 0, p); save(true); }),
    item('Share as link…', () => openShare(p)),
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
      el('code', {}, '*'), ' is a wildcard. With no "Only on" filter the profile applies everywhere.'),
    tabOnly,
    el('p', { class: 'hint' }, 'Request types (none ticked = all, including page loads):'), types,
    el('p', { class: 'hint' }, 'Methods (none ticked = all). CORS preflights are OPTIONS requests:'), methods);
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
    el('h3', {}, 'Request headers'),
    el('div', { class: 'rows', id: 'req-rows' }, req.length ? req.map((h) => headerRow(p, h)) : el('div', { class: 'empty' }, 'None.')),
    el('div', { class: 'add' }, el('button', { type: 'button', id: 'add-req', onclick: () => addHeader(p, 'request') }, '+ Request header')),
    el('h3', {}, 'Response headers'),
    el('div', { class: 'rows', id: 'res-rows' }, res.length ? res.map((h) => headerRow(p, h)) : el('div', { class: 'empty' }, 'None.')),
    el('div', { class: 'add' }, el('button', { type: 'button', id: 'add-res', onclick: () => addHeader(p, 'response') }, '+ Response header')),
    det);
}

function addHeader(p, target) {
  const h = HD.newHeader(target);
  p.headers.push(h);
  save(true);
  const input = document.querySelector(`[data-id="${h.id}"] input.name`);
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
  const ask = (origins) => api.permissions.request({ origins }).then(renderAccess).catch((e) => alert(e.message));
  box.className = 'banner' + (granted.length ? ' info' : '');
  box.replaceChildren(
    el('span', {}, granted.length
      ? `Headers are changed on ${granted.length} site${granted.length > 1 ? 's' : ''} you allowed.`
      : 'HeaderDial needs your permission before it can change headers on websites.'),
    el('button', { type: 'button', class: granted.length ? '' : 'primary', onclick: () => ask(['<all_urls>']) }, 'Allow on all sites'),
    host && !hostGranted && el('button', { type: 'button', onclick: () => ask([host + '/*']) }, 'Only ' + new URL(host).host));
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

$('share-copy').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await navigator.clipboard.writeText($('share-text').value); } catch (_) { $('share-text').select(); document.execCommand('copy'); }
  $('share-msg').className = 'msg ok'; $('share-msg').textContent = 'Copied.';
});

$('import').addEventListener('click', () => { $('import-msg').textContent = ''; $('import-dialog').showModal(); });
$('import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) $('import-text').value = await f.text();
});
$('import-go').addEventListener('click', (e) => {
  e.preventDefault();
  const msg = $('import-msg');
  try {
    const res = HD.parseImport($('import-text').value);
    if ($('import-replace').checked) state.profiles = res.profiles;
    else state.profiles = state.profiles.concat(res.profiles);
    state.selectedId = res.profiles[0].id;
    saveNow(); render();
    msg.className = 'msg ok';
    msg.textContent = `Imported ${res.profiles.length} profile${res.profiles.length > 1 ? 's' : ''} from ${res.source}.` +
      (res.warnings.length ? '\n' + res.warnings.join('\n') : '');
    $('import-text').value = '';
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
  const got = await api.storage.local.get(['state', 'status']);
  state = HD.normalizeState(got.state);
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
