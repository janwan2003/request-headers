// HeaderDial background: keeps the browser's declarativeNetRequest rules in sync with
// the saved profiles. It makes no network requests of its own.
'use strict';
if (typeof importScripts === 'function' && !self.HeaderDial) importScripts('lib/model.js', 'lib/transfer.js');
const HD = self.HeaderDial;
const api = typeof browser !== 'undefined' ? browser : chrome;
const dnr = api.declarativeNetRequest;

function supportedTypes() {
  const e = dnr.ResourceType;
  if (!e) return HD.RESOURCE_TYPES;
  const vals = Object.values(e);
  return HD.RESOURCE_TYPES.filter((t) => vals.includes(t));
}

async function loadState() {
  const { state } = await api.storage.local.get('state');
  return HD.normalizeState(state);
}

// Replace all rules of one kind. If the browser rejects the batch, add rules one at a
// time so a single bad rule (say, a regex the browser cannot compile) does not
// disable every other header.
async function replaceRules(kind, rules, problems, state) {
  const get = kind === 'session' ? dnr.getSessionRules : dnr.getDynamicRules;
  const update = (kind === 'session' ? dnr.updateSessionRules : dnr.updateDynamicRules).bind(dnr);
  const existing = await get.call(dnr);
  const removeRuleIds = existing.map((r) => r.id);
  try {
    await update({ removeRuleIds, addRules: rules });
    return rules.length;
  } catch (err) {
    await update({ removeRuleIds, addRules: [] });
    let ok = 0;
    for (const r of rules) {
      try {
        await update({ addRules: [r] });
        ok++;
      } catch (e) {
        const msg = String((e && e.message) || e).replace(/^Rule with id \d+ /, '');
        problems.push({ message: describeRule(r, state) + ': the browser rejected this rule (' + msg + ')' });
      }
    }
    return ok;
  }
}

function describeRule(r, state) {
  const c = r.condition;
  const where = c.regexFilter ? 'regex ' + c.regexFilter : c.urlFilter ? 'pattern ' + c.urlFilter :
    c.requestDomains ? 'domains ' + c.requestDomains.join(', ') : 'all URLs';
  const heads = [].concat(r.action.requestHeaders || [], r.action.responseHeaders || []).map((h) => h.header);
  return (heads.length ? heads.join(', ') : 'exclusion') + ' on ' + where;
}

async function setBadge(state, live) {
  const action = api.action;
  if (!action) return;
  if (state.paused) {
    await action.setBadgeText({ text: 'off' });
    await action.setBadgeBackgroundColor({ color: '#6b7280' });
    await action.setTitle({ title: 'HeaderDial: paused' });
    return;
  }
  const first = state.profiles.find((p) => p.active);
  await action.setBadgeText({ text: live ? String(live) : '' });
  await action.setBadgeBackgroundColor({ color: first ? first.color : '#2563eb' });
  await action.setTitle({ title: `HeaderDial: ${live} header${live === 1 ? '' : 's'} active` });
}

let running = null;
let again = false;
async function sync() {
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      const state = await loadState();
      const out = HD.compile(state, { now: Date.now(), resourceTypes: supportedTypes() });
      const problems = out.problems.slice();
      const applied = (await replaceRules('dynamic', out.dynamic, problems, state)) +
        (await replaceRules('session', out.session, problems, state));
      if (out.nextExpiry) api.alarms.create('expiry', { when: Math.max(out.nextExpiry + 500, Date.now() + 1000) });
      else api.alarms.clear('expiry');
      await setBadge(state, out.liveCount);
      await api.storage.local.set({ status: { at: Date.now(), rules: applied, live: out.liveCount, problems } });
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.state) sync();
});
api.alarms.onAlarm.addListener((a) => { if (a.name === 'expiry') sync(); });
api.runtime.onInstalled.addListener(() => sync());
// Tab ids are not kept across browser restarts, so tab-bound profiles are switched off.
api.runtime.onStartup.addListener(async () => {
  const state = await loadState();
  let changed = false;
  for (const p of state.profiles) if (p.tabId != null) { p.tabId = null; p.tabLabel = ''; p.active = false; changed = true; }
  if (changed) await api.storage.local.set({ state }); // triggers sync via onChanged
  else sync();
});
// Tab-scoped profiles: forget the tab when it closes.
api.tabs.onRemoved.addListener(async (tabId) => {
  const state = await loadState();
  let changed = false;
  for (const p of state.profiles) if (p.tabId === tabId) { p.tabId = null; p.tabLabel = ''; p.active = false; changed = true; }
  if (changed) await api.storage.local.set({ state });
});
api.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === 'sync') { sync().then(() => reply({ ok: true })); return true; }
  return false;
});
