// Measure what Chrome (CDP: Network extraInfo blocked/associated cookies, Audits cookie issues, Log) and
// Firefox (chrome-scope Services.console listener + WebDriver BiDi log.entryAdded) report when a cookie is
// rejected on set or not sent on a request. Hosts a.test / b.test / other.test are mapped to 127.0.0.1;
// HTTPS (self-signed, generated with openssl into .tmp/cookie-measure/) on PS, plain HTTP on PH.
// Usage: node test/measure-cookie-messages.js [chrome|firefox|both] [runs] [--fixture]
//   writes .tmp/cookie-measure/results.json; --fixture also writes test/fixtures/cookie-messages.json
//   env: ONLY=<regex on scenario id>, PS/PH ports (default 8443/8080, else free ports; normalised to 8443/8080)
'use strict';
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), os = require('os'), net = require('net');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = process.env.OUT || path.join(ROOT, '.tmp', 'cookie-measure');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || path.join(os.homedir(), '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome');
const FIREFOX = process.env.FIREFOX || 'firefox';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const which = args[0] || 'both';
const RUNS = Number(args[1] || 2);
const WRITE_FIXTURE = process.argv.includes('--fixture');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (x) => Buffer.from(JSON.stringify(x), 'latin1').toString('base64url');

// Issues-panel description files (devtools-frontend main @ 22dfc603, front_end/models/issues_manager/CookieIssue.ts
// issueDescriptions map) and their first '# ' line. Used when the shipped .md cannot be loaded from devtools://.
const ISSUE_FILES = {
  'CookieIssue::WarnSameSiteUnspecifiedLaxAllowUnsafe::ReadCookie': 'SameSiteUnspecifiedLaxAllowUnsafeRead.md',
  'CookieIssue::WarnSameSiteUnspecifiedLaxAllowUnsafe::SetCookie': 'SameSiteUnspecifiedLaxAllowUnsafeSet.md',
  'CookieIssue::WarnSameSiteUnspecifiedCrossSiteContext::ReadCookie': 'SameSiteUnspecifiedLaxAllowUnsafeRead.md',
  'CookieIssue::WarnSameSiteUnspecifiedCrossSiteContext::SetCookie': 'SameSiteUnspecifiedLaxAllowUnsafeSet.md',
  'CookieIssue::ExcludeSameSiteNoneInsecure::ReadCookie': 'SameSiteNoneInsecureErrorRead.md',
  'CookieIssue::ExcludeSameSiteNoneInsecure::SetCookie': 'SameSiteNoneInsecureErrorSet.md',
  'CookieIssue::WarnSameSiteNoneInsecure::ReadCookie': 'SameSiteNoneInsecureWarnRead.md',
  'CookieIssue::WarnSameSiteNoneInsecure::SetCookie': 'SameSiteNoneInsecureWarnSet.md',
  'CookieIssue::WarnAttributeValueExceedsMaxSize::ReadCookie': 'CookieAttributeValueExceedsMaxSize.md',
  'CookieIssue::WarnAttributeValueExceedsMaxSize::SetCookie': 'CookieAttributeValueExceedsMaxSize.md',
  'CookieIssue::WarnDomainNonASCII::ReadCookie': 'cookieWarnDomainNonAscii.md',
  'CookieIssue::WarnDomainNonASCII::SetCookie': 'cookieWarnDomainNonAscii.md',
  'CookieIssue::ExcludeDomainNonASCII::ReadCookie': 'cookieExcludeDomainNonAscii.md',
  'CookieIssue::ExcludeDomainNonASCII::SetCookie': 'cookieExcludeDomainNonAscii.md',
  'CookieIssue::CrossSiteRedirectDowngradeChangesInclusion': 'cookieCrossSiteRedirectDowngrade.md',
  'CookieIssue::ExcludePortMismatch': 'cookieExcludePortMismatch.md',
  'CookieIssue::ExcludeSchemeMismatch': 'cookieExcludeSchemeMismatch.md',
};
// Issue codes that DevTools keeps out of the Issues panel (placeholderDescriptionForInvisibleIssues.md).
const INVISIBLE = /::(WarnThirdPartyPhaseout|WarnDeprecationTrialMetadata|WarnThirdPartyCookieHeuristic|ExcludeThirdPartyPhaseout)::/;

// Mirrors CookieIssue.codeForCookieIssueDetails (one issue code per reason).
function issueCodes(d) {
  const ex = d.cookieExclusionReasons || [], wa = d.cookieWarningReasons || [], op = d.operation;
  const codes = [];
  for (const r of ex.length ? ex : wa) {
    if (['ExcludeSameSiteStrict', 'ExcludeSameSiteLax', 'ExcludeSameSiteUnspecifiedTreatedAsLax'].includes(r) && wa.includes('WarnCrossSiteRedirectDowngradeChangesInclusion')) codes.push('CookieIssue::CrossSiteRedirectDowngradeChangesInclusion');
    else if (r === 'ExcludePortMismatch' || r === 'ExcludeSchemeMismatch') codes.push('CookieIssue::' + r);
    else codes.push(['CookieIssue', r, op].join('::'));
  }
  return codes;
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
function portFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer().once('error', () => resolve(false)).listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function makeCert() {
  const key = path.join(OUT, 'key.pem'), crt = path.join(OUT, 'cert.pem');
  if (!fs.existsSync(crt)) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '30', '-subj', '/CN=a.test',
      '-addext', 'subjectAltName=DNS:a.test,DNS:b.test,DNS:api.b.test,DNS:other.test'], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

// Server: /page (HTML), /set?c=<b64 JSON array of raw Set-Cookie values> (written raw on the socket so that
// control characters survive), /echo (JSON of the Cookie header the server received). CORS echoes Origin + credentials.
const serverLog = [];
function handler(scheme) {
  return (req, res) => {
    const u = new URL(req.url, 'http://x');
    const origin = req.headers.origin;
    serverLog.push({ scheme, host: req.headers.host, path: u.pathname, cookie: req.headers.cookie || '' });
    const cors = origin ? `Access-Control-Allow-Origin: ${origin}\r\nAccess-Control-Allow-Credentials: true\r\nVary: Origin\r\n` : '';
    if (u.pathname === '/set') {
      const lines = JSON.parse(Buffer.from(u.searchParams.get('c'), 'base64url').toString('latin1'));
      const body = 'set ' + lines.length;
      const head = `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\n${cors}` +
        lines.map((l) => `Set-Cookie: ${l}\r\n`).join('') + `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`;
      req.socket.end(Buffer.from(head, 'latin1'));
      return;
    }
    const send = (status, type, body) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...(origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin' } : {}) }); res.end(body); };
    if (u.pathname === '/page') return send(200, 'text/html', '<!doctype html><title>page</title><h1>page</h1>');
    if (u.pathname === '/echo') return send(200, 'application/json', JSON.stringify({ cookie: req.headers.cookie || '' }));
    if (u.pathname === '/favicon.ico') return send(204, 'text/plain', '');
    return send(404, 'text/plain', 'nf');
  };
}

function scenarios(PS, PH) {
  const A = `https://a.test:${PS}`, B = `https://b.test:${PS}`, AH = `http://a.test:${PH}`;
  const set = (o, lines) => `${o}/set?c=${b64(lines)}`;
  const xfetch = (url) => ({ fetch: url, cred: true });
  const sc = (id, page, setCookie, steps, check, notes) => ({ id, page, setCookie, steps, check, notes });
  return [
    sc('s0-control-none-secure', A, ['s0ok=1; SameSite=None; Secure'], [{ goto: `${A}/page` }, xfetch(set(B, ['s0ok=1; SameSite=None; Secure']))], B, 'control: cross-site credentialed fetch, SameSite=None; Secure'),
    sc('s1-samesite-none-no-secure', A, ['s1none=1; SameSite=None'], [{ goto: `${A}/page` }, xfetch(set(B, ['s1none=1; SameSite=None']))], B),
    sc('s2-no-samesite-cross-site', A, ['s2unspec=1'], [{ goto: `${A}/page` }, xfetch(set(B, ['s2unspec=1']))], B),
    sc('s3-strict-cross-site-set', A, ['s3strict=1; SameSite=Strict; Secure'], [{ goto: `${A}/page` }, xfetch(set(B, ['s3strict=1; SameSite=Strict; Secure']))], B),
    sc('s4-lax-not-sent-cross-site-fetch', A, ['s4lax=1; SameSite=Lax; Secure'], [{ goto: set(B, ['s4lax=1; SameSite=Lax; Secure']) }, { goto: `${A}/page` }, xfetch(`${B}/echo`)], B, 'cookie set by a top-level visit to b.test first; request side'),
    sc('s5-strict-not-sent-top-level-link', A, ['s5strict=1; SameSite=Strict; Secure', 's5lax=1; SameSite=Lax; Secure'], [{ goto: set(B, ['s5strict=1; SameSite=Strict; Secure', 's5lax=1; SameSite=Lax; Secure']) }, { goto: `${A}/page` }, { click: `${B}/echo` }], B, 'link click a.test -> b.test/echo; body shows what the server got'),
    sc('s6-secure-from-http', AH, ['s6sec=1; Secure'], [{ goto: `${AH}/page` }, { fetch: set(AH, ['s6sec=1; Secure']) }], AH),
    sc('s7-domain-mismatch', B, ['s7dom=1; Domain=other.test'], [{ goto: `${B}/page` }, { fetch: set(B, ['s7dom=1; Domain=other.test']) }], B),
    sc('s8a-host-prefix-with-domain', B, ['__Host-s8h=1; Path=/; Domain=b.test; Secure'], [{ goto: `${B}/page` }, { fetch: set(B, ['__Host-s8h=1; Path=/; Domain=b.test; Secure']) }], B),
    sc('s8b-secure-prefix-no-secure', B, ['__Secure-s8s=1'], [{ goto: `${B}/page` }, { fetch: set(B, ['__Secure-s8s=1']) }], B),
    sc('s9-oversize', B, ['s9big=' + 'x'.repeat(4100)], [{ goto: `${B}/page` }, { fetch: set(B, ['s9big=' + 'x'.repeat(4100)]) }], B, 'name+value = 4105 bytes'),
    sc('s10-http-overwrites-secure', AH, ['s10=plain'], [{ goto: set(A, ['s10=secure; Secure']) }, { goto: `${AH}/page` }, { fetch: set(AH, ['s10=plain']) }], AH, 's10=secure; Secure set first by https://a.test'),
    sc('s11-partitioned-no-secure', B, ['s11part=1; Partitioned'], [{ goto: `${B}/page` }, { fetch: set(B, ['s11part=1; Partitioned']) }], B, 'same-site response over https'),
    sc('s12-third-party', A, ['s12new=1; SameSite=None; Secure'], [{ goto: set(B, ['s12pre=1; SameSite=None; Secure']) }, { goto: `${A}/page` }, xfetch(set(B, ['s12new=1; SameSite=None; Secure'])), xfetch(`${B}/echo`)], B, 's12pre set first-party by a top-level visit to b.test, then cross-site set (s12new) and read (/echo) from a.test'),
    sc('s13-script-overwrites-httponly', B, ['s13h=1; HttpOnly; Path=/'], [{ goto: `${B}/page` }, { fetch: set(B, ['s13h=1; HttpOnly; Path=/']) }, { js: `document.cookie = 's13h=2; Path=/'; 'document.cookie=' + JSON.stringify(document.cookie)` }], B, "then document.cookie = 's13h=2; Path=/'"),
    sc('s14a-space-in-name', B, ['a b=1'], [{ goto: `${B}/page` }, { fetch: set(B, ['a b=1']) }], B),
    sc('s14b-control-char-in-value', B, ['s14c=1\x01x'], [{ goto: `${B}/page` }, { fetch: set(B, ['s14c=1\x01x']) }], B, 'value contains U+0001'),
    sc('s14c-tab-in-name', B, ['s14\tt=1'], [{ goto: `${B}/page` }, { fetch: set(B, ['s14\tt=1']) }], B, 'name contains a TAB'),
    sc('s14d-semicolon-only-and-empty', B, ['=s14empty', ''], [{ goto: `${B}/page` }, { fetch: set(B, ['=s14empty', '']) }], B, 'empty name with value, and an entirely empty Set-Cookie'),
    sc('s15-delete-max-age-0-and-expires-past', B, ['s15m=; Max-Age=0', 's15e=; Expires=Thu, 01 Jan 1970 00:00:00 GMT'], [{ goto: `${B}/page` }, { fetch: set(B, ['s15m=1', 's15e=1']) }, { fetch: set(B, ['s15m=; Max-Age=0', 's15e=; Expires=Thu, 01 Jan 1970 00:00:00 GMT']) }], B, 's15m=1 and s15e=1 set first'),
  ];
}

const PRELUDE = `const f = async (url, init) => { try { const r = await fetch(url, init); return 'status=' + r.status + ' body=' + (await r.text()).slice(0, 300); } catch (e) { return e.name + ': ' + e.message; } };`;

// ---------------- Chrome ----------------
async function chromeStrings(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const out = { ui: null, md: {} };
  try {
    const r = await page.goto('devtools://devtools/bundled/core/i18n/locales/en-US.json');
    const L = JSON.parse(await r.text());
    out.ui = Object.fromEntries(Object.entries(L).filter(([k]) => k.startsWith('core/sdk/NetworkRequest.ts | ')).map(([k, v]) => [k.split(' | ')[1], v.message]));
  } catch (e) { out.uiError = e.message; }
  for (const f of new Set(Object.values(ISSUE_FILES))) {
    try {
      const r = await page.goto('devtools://devtools/bundled/models/issues_manager/descriptions/' + f);
      out.md[f] = (await r.text()).split('\n').find((l) => l.startsWith('# ')) || null;
    } catch (e) { out.md[f] = null; }
  }
  await ctx.close();
  return out;
}

// Enum -> UIStrings key, from setCookieBlockedReasonToUiString / cookieBlockedReasonToUiString / cookieExemptionReasonToUiString.
const SET_KEYS = { SecureOnly: 'blockedReasonSecureOnly', SameSiteNoneInsecure: 'blockedReasonSameSiteNoneInsecure', UserPreferences: 'thisSetcookieWasBlockedDueToUser', SyntaxError: 'thisSetcookieHadInvalidSyntax', SchemeNotSupported: 'theSchemeOfThisConnectionIsNot', OverwriteSecure: 'blockedReasonOverwriteSecure', InvalidDomain: 'blockedReasonInvalidDomain', InvalidPrefix: 'blockedReasonInvalidPrefix', UnknownError: 'anUnknownErrorWasEncounteredWhenTrying', SchemefulSameSiteStrict: ['blockedReasonSameSiteStrictLax', 'SameSite=Strict'], SchemefulSameSiteLax: ['blockedReasonSameSiteStrictLax', 'SameSite=Lax'], SchemefulSameSiteUnspecifiedTreatedAsLax: 'blockedReasonSameSiteUnspecifiedTreatedAsLax', NameValuePairExceedsMaxSize: 'thisSetcookieWasBlockedBecauseTheNameValuePairExceedsMaxSize', DisallowedCharacter: 'thisSetcookieHadADisallowedCharacter', ThirdPartyPhaseout: 'thisSetcookieWasBlockedDueThirdPartyPhaseout' };
const REQ_KEYS = { SecureOnly: 'secureOnly', NotOnPath: 'notOnPath', DomainMismatch: 'domainMismatch', SameSiteNoneInsecure: 'sameSiteNoneInsecure', UserPreferences: 'userPreferences', UnknownError: 'unknownError', SchemefulSameSiteStrict: 'sameSiteStrict', SchemefulSameSiteLax: 'sameSiteLax', SchemefulSameSiteUnspecifiedTreatedAsLax: 'sameSiteUnspecifiedTreatedAsLax', NameValuePairExceedsMaxSize: 'nameValuePairExceedsMaxSize', ThirdPartyPhaseout: 'thirdPartyPhaseout' };
const EXEMPT_KEYS = { UserSetting: 'exemptionReasonUserSetting', EnterprisePolicy: 'exemptionReasonEnterprisePolicy', StorageAccess: 'exemptionReasonStorageAccessAPI', TopLevelStorageAccess: 'exemptionReasonTopLevelStorageAccessAPI', Scheme: 'exemptionReasonScheme' };
function ui(strings, table, reason) {
  const k = table[reason];
  if (!k || !strings.ui) return null;
  return Array.isArray(k) ? strings.ui[k[0]].replace('{PH1}', k[1]) : strings.ui[k];
}

async function runChromeVariant(variant, list, PS, PH) {
  const extra = variant === 'chrome-3pcd-flag' ? ['--test-third-party-cookie-phaseout'] : [];
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--host-resolver-rules=MAP *.test 127.0.0.1', '--ignore-certificate-errors', ...extra] });
  const version = browser.version();
  const strings = await chromeStrings(browser);
  const out = [];
  for (const s of list) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      const urls = {}, setBlocked = [], setExempt = [], reqBlocked = [], reqExempt = [], issues = [], logs = [], consoleMsgs = [], stepResults = [];
      cdp.on('Network.requestWillBeSent', (e) => { urls[e.requestId] = e.request.url; });
      cdp.on('Network.responseReceivedExtraInfo', (e) => {
        for (const c of e.blockedCookies || []) setBlocked.push({ requestId: e.requestId, cookieLine: c.cookieLine, name: c.cookie && c.cookie.name, blockedReasons: c.blockedReasons });
        for (const c of e.exemptedCookies || []) setExempt.push({ requestId: e.requestId, cookieLine: c.cookieLine, exemptionReason: c.exemptionReason });
      });
      cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
        for (const c of e.associatedCookies || []) {
          if (c.blockedReasons && c.blockedReasons.length) reqBlocked.push({ requestId: e.requestId, name: c.cookie.name, blockedReasons: c.blockedReasons });
          if (c.exemptionReason && c.exemptionReason !== 'None') reqExempt.push({ requestId: e.requestId, name: c.cookie.name, exemptionReason: c.exemptionReason });
        }
      });
      cdp.on('Audits.issueAdded', ({ issue }) => { if (issue.code === 'CookieIssue') issues.push(issue.details.cookieIssueDetails); });
      cdp.on('Log.entryAdded', ({ entry }) => logs.push({ source: entry.source, level: entry.level, text: entry.text }));
      page.on('console', (m) => consoleMsgs.push(m.type() + ': ' + m.text()));
      await cdp.send('Network.enable');
      await cdp.send('Audits.enable');
      await cdp.send('Log.enable');
      if (variant === 'chrome-cookie-controls') {
        try { await cdp.send('Network.setCookieControls', { enableThirdPartyCookieRestriction: true, disableThirdPartyCookieMetadata: true, disableThirdPartyCookieHeuristics: true }); stepResults.push('setCookieControls ok'); }
        catch (e) { stepResults.push('setCookieControls error: ' + e.message); }
      }
      for (const st of s.steps) {
        try {
          if (st.goto) { await page.goto(st.goto); stepResults.push('goto -> ' + page.url()); }
          else if (st.fetch) stepResults.push('fetch -> ' + await page.evaluate('(() => { ' + PRELUDE + ` return f(${JSON.stringify(st.fetch)}, ${st.cred ? "{ credentials: 'include' }" : '{}'}); })()`));
          else if (st.click) {
            await page.evaluate((u) => { const a = document.createElement('a'); a.href = u; a.id = 'go'; a.textContent = 'go'; document.body.append(a); }, st.click);
            await Promise.all([page.waitForURL(st.click), page.click('#go')]);
            stepResults.push('click -> ' + page.url() + ' body=' + await page.textContent('body'));
          } else if (st.js) stepResults.push('js -> ' + await page.evaluate(st.js));
        } catch (e) { stepResults.push('STEP ERROR ' + e.message.split('\n')[0]); }
      }
      await sleep(500);
      let stored = [];
      try { stored = (await cdp.send('Network.getCookies', { urls: [`https://a.test:${PS}/`, `https://b.test:${PS}/`, `http://a.test:${PH}/`, `https://other.test:${PS}/`] })).cookies; } catch (e) { stored = [{ name: 'ERR ' + e.message, value: '' }]; }
      // Follow-up checks: credentialed fetch from the current page, then a top-level visit to the cookie's origin.
      const follow = await page.evaluate('(() => { ' + PRELUDE + ` return f(${JSON.stringify(s.check + '/echo')}, { credentials: 'include' }); })()`).catch((e) => 'ERR ' + e.message);
      let top = null;
      try { await page.goto(s.check + '/echo'); top = { body: await page.textContent('body'), documentCookie: await page.evaluate('document.cookie') }; } catch (e) { top = 'ERR ' + e.message; }
      runs.push({
        steps: stepResults,
        setCookieBlocked: setBlocked.map((x) => ({ ...x, url: urls[x.requestId], requestId: undefined })),
        setCookieExempted: setExempt.map((x) => ({ ...x, url: urls[x.requestId], requestId: undefined })),
        requestCookieBlocked: reqBlocked.map((x) => ({ ...x, url: urls[x.requestId], requestId: undefined })),
        requestCookieExempted: reqExempt.map((x) => ({ ...x, url: urls[x.requestId], requestId: undefined })),
        issues: issues.map((d) => ({ name: d.cookie ? d.cookie.name : null, rawCookieLine: d.rawCookieLine, cookieWarningReasons: d.cookieWarningReasons, cookieExclusionReasons: d.cookieExclusionReasons, operation: d.operation, cookieUrl: d.cookieUrl, codes: issueCodes(d) })),
        logEntries: logs, console: consoleMsgs,
        stored: stored.sort((x, y) => (x.name < y.name ? -1 : 1)).map((c) => ({ name: c.name, value: c.value.length > 20 ? c.value.slice(0, 20) + '…(' + c.value.length + ')' : c.value, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, partitionKey: c.partitionKey })),
        followUpFetch: follow, topLevelCheck: top,
      });
      await ctx.close();
    }
    out.push({ scenario: s.id, variant, browser: 'chrome', browserVersion: version, setCookie: s.setCookie, pageUrl: s.page, notes: s.notes, stableAcrossRuns: stable(runs, ['steps', 'setCookieBlocked', 'requestCookieBlocked', 'issues', 'logEntries', 'stored']), runs });
    process.stderr.write(`${variant} ${s.id} done\n`);
  }
  await browser.close();
  return { results: out, strings };
}

function stable(runs, keys) {
  const k = (r) => JSON.stringify(keys.map((x) => r[x]));
  return runs.every((r) => k(r) === k(runs[0]));
}

// ---------------- Firefox ----------------
async function launchFirefox() {
  const profile = fs.mkdtempSync(path.join(OUT, 'fx-prof-'));
  fs.writeFileSync(path.join(profile, 'user.js'), [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("devtools.jsonview.enabled", false);',
    'user_pref("network.dns.localDomains", "a.test,b.test,api.b.test,other.test");',
    'user_pref("dom.security.https_first", false);',
    'user_pref("dom.security.https_first_pbm", false);',
    'user_pref("dom.security.https_only_mode", false);',
    'user_pref("network.dns.native_https_query", false);',
  ].join('\n') + '\n');
  const port = await freePort();
  const proc = spawn(FIREFOX, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), '--remote-allow-system-access'],
    { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
  await new Promise((resolve, reject) => {
    let err = '';
    const t = setTimeout(() => reject(new Error('Firefox did not start BiDi: ' + err.slice(-500))), 30000);
    proc.stderr.on('data', (d) => { err += d; if (/WebDriver BiDi listening/.test(err)) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => reject(new Error('Firefox exited ' + c + ': ' + err.slice(-500))));
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let next = 1;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.type === 'error') reject(new Error(m.error + ': ' + m.message)); else resolve(m.result);
    } else if (m.type === 'event') events.push(m);
  };
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const sess = await send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  const close = async () => {
    try { await send('browser.close', {}); } catch (e) { /* socket closes as Firefox exits */ }
    ws.close();
    await Promise.race([new Promise((r) => proc.once('exit', r)), sleep(10000)]);
    if (proc.exitCode == null) proc.kill();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  };
  return { send, events, close, version: sess.capabilities.browserVersion };
}

const FX_LISTENER = `(() => {
  if (!globalThis.__ckLog) {
    globalThis.__ckLog = [];
    Services.console.registerListener({ observe(m) {
      if (m instanceof Ci.nsIScriptError) globalThis.__ckLog.push({ msg: m.errorMessage, cat: m.category, flags: m.flags, src: m.sourceName });
      else globalThis.__ckLog.push({ msg: m.message, cat: 'nsIConsoleMessage' });
    } });
  }
  return 'ok';
})()`;

async function runFirefoxVariant(variant, list, PS, PH) {
  const b = await launchFirefox();
  const { contexts: chromeCtx } = await b.send('browsingContext.getTree', { 'moz:scope': 'chrome' });
  const chrome = chromeCtx[0].context;
  const evalChrome = async (expr) => (await b.send('script.evaluate', { expression: expr, target: { context: chrome }, awaitPromise: true, 'moz:scope': 'chrome' })).result.value;
  await evalChrome(FX_LISTENER);
  const behavior = variant === 'firefox-cookieBehavior1' ? 1 : null;
  if (behavior != null) await evalChrome(`Services.prefs.setIntPref('network.cookie.cookieBehavior', ${behavior}); 'ok'`);
  const prefs = await evalChrome(`JSON.stringify({ cookieBehavior: Services.prefs.getIntPref('network.cookie.cookieBehavior'), laxByDefault: Services.prefs.getBoolPref('network.cookie.sameSite.laxByDefault', null), noneRequiresSecure: Services.prefs.getBoolPref('network.cookie.sameSite.noneRequiresSecure', null), schemeful: Services.prefs.getBoolPref('network.cookie.sameSite.schemeful', null) })`);
  await b.send('session.subscribe', { events: ['log.entryAdded'] });
  const out = [];
  for (const s of list) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const { userContext } = await b.send('browser.createUserContext', {});
      const { context } = await b.send('browsingContext.create', { type: 'tab', userContext });
      await evalChrome('globalThis.__ckLog.length = 0');
      b.events.length = 0;
      const ev = async (expr) => { const r = await b.send('script.evaluate', { expression: expr, target: { context }, awaitPromise: true }); return r.type === 'success' ? r.result.value : 'EVAL EXCEPTION: ' + JSON.stringify(r.exceptionDetails && r.exceptionDetails.text); };
      const nav = async (url) => { await b.send('browsingContext.navigate', { context, url, wait: 'complete' }); return ev('location.href'); };
      const stepResults = [];
      for (const st of s.steps) {
        try {
          if (st.goto) stepResults.push('goto -> ' + await nav(st.goto));
          else if (st.fetch) stepResults.push('fetch -> ' + await ev('(() => { ' + PRELUDE + ` return f(${JSON.stringify(st.fetch)}, ${st.cred ? "{ credentials: 'include' }" : '{}'}); })()`));
          else if (st.click) {
            await ev(`(() => { const a = document.createElement('a'); a.href = ${JSON.stringify(st.click)}; a.id = 'go'; document.body.append(a); a.click(); return 1; })()`);
            for (let k = 0; k < 40; k++) { await sleep(100); const h = await ev('location.href').catch(() => ''); if (h === st.click) break; }
            await sleep(300);
            stepResults.push('click -> ' + await ev('location.href + " body=" + document.body.innerText'));
          } else if (st.js) stepResults.push('js -> ' + await ev(st.js));
        } catch (e) { stepResults.push('STEP ERROR ' + e.message); }
      }
      await sleep(800);
      const follow = await ev('(() => { ' + PRELUDE + ` return f(${JSON.stringify(s.check + '/echo')}, { credentials: 'include' }); })()`).catch((e) => 'ERR ' + e.message);
      const all = JSON.parse(await evalChrome('JSON.stringify(globalThis.__ckLog)'));
      const bidi = b.events.filter((e) => e.method === 'log.entryAdded').map((e) => ({ type: e.params.type, level: e.params.level, text: e.params.text }));
      let top = null;
      try { await nav(s.check + '/echo'); top = { body: await ev('document.body.innerText'), documentCookie: await ev('document.cookie') }; } catch (e) { top = 'ERR ' + e.message; }
      const content = all.filter((x) => x.cat !== 'nsIConsoleMessage' && !/^(chrome|resource|moz-extension):/.test(x.src || ''));
      runs.push({ steps: stepResults, consoleMessages: content.map((x) => ({ text: x.msg, category: x.cat, flags: x.flags, source: x.src })), bidiLogEntries: bidi,
        droppedConsoleServiceMessages: all.filter((x) => !content.includes(x)).map((x) => `[${x.cat}] ${x.msg}`.slice(0, 200)), followUpFetch: follow, topLevelCheck: top });
      await b.send('browsingContext.close', { context });
      await b.send('browser.removeUserContext', { userContext });
    }
    out.push({ scenario: s.id, variant, browser: 'firefox', browserVersion: b.version, prefs: JSON.parse(prefs), setCookie: s.setCookie, pageUrl: s.page, notes: s.notes,
      stableAcrossRuns: stable(runs.map((r) => ({ ...r, msgs: r.consoleMessages.map((m) => m.text) })), ['steps', 'msgs']), runs });
    process.stderr.write(`${variant} ${s.id} done\n`);
  }
  await b.close();
  return out;
}

// ---------------- fixture ----------------
function norm(s, PS, PH) {
  return typeof s === 'string' ? s.split(':' + PS).join(':8443').split(':' + PH).join(':8080') : s;
}
function buildFixture(results, strings, PS, PH) {
  const fx = [];
  const nameOf = (line) => (line || '').split(';')[0].split('=')[0].trim();
  const add = (o) => { const k = JSON.stringify([o.scenario, o.browser, o.kind, o.text, o.cookieName]); if (!fx.some((e) => e._k === k)) fx.push({ _k: k, ...o }); };
  for (const r of results) {
    const run = r.runs[0];
    const scen = r.variant === 'chrome' || r.variant === 'firefox' ? r.scenario : `${r.scenario}@${r.variant}`;
    const base = { scenario: scen, browser: r.browser };
    if (r.browser === 'chrome') {
      for (const c of run.setCookieBlocked) {
        const common = { ...base, setCookie: c.cookieLine, cookieName: c.name || nameOf(c.cookieLine), pageUrl: norm(r.pageUrl + '/page', PS, PH), requestUrl: norm(c.url, PS, PH) };
        add({ ...common, kind: 'cdp-reason', text: c.blockedReasons.join(', '), reasons: c.blockedReasons, side: 'set' });
        for (const reason of c.blockedReasons) add({ ...common, kind: 'devtools-network', text: ui(strings, SET_KEYS, reason), reasons: [reason], side: 'set' });
      }
      for (const c of run.requestCookieBlocked) {
        const common = { ...base, setCookie: null, cookieName: c.name, pageUrl: norm(r.pageUrl + '/page', PS, PH), requestUrl: norm(c.url, PS, PH) };
        add({ ...common, kind: 'cdp-reason', text: c.blockedReasons.join(', '), reasons: c.blockedReasons, side: 'request' });
        for (const reason of c.blockedReasons) add({ ...common, kind: 'devtools-network', text: ui(strings, REQ_KEYS, reason), reasons: [reason], side: 'request' });
      }
      for (const c of [...run.setCookieExempted, ...run.requestCookieExempted]) {
        add({ ...base, kind: 'devtools-network', setCookie: c.cookieLine || null, cookieName: c.name || nameOf(c.cookieLine), pageUrl: norm(r.pageUrl + '/page', PS, PH), requestUrl: norm(c.url, PS, PH), text: ui(strings, EXEMPT_KEYS, c.exemptionReason), reasons: [c.exemptionReason], side: c.cookieLine ? 'set' : 'request', exemption: true });
      }
      for (const is of run.issues) {
        for (const code of is.codes) {
          const file = ISSUE_FILES[code];
          const headline = file ? (strings.md[file] || null) : null;
          add({ ...base, kind: 'devtools-issue', setCookie: is.rawCookieLine || null, cookieName: is.name, pageUrl: norm(r.pageUrl + '/page', PS, PH), requestUrl: norm(is.cookieUrl, PS, PH),
            text: headline ? headline.replace(/^# /, '') : null, reasons: [...(is.cookieExclusionReasons || []), ...(is.cookieWarningReasons || [])], issueCode: code, issueFile: file || null,
            shownInIssuesPanel: !!file && !INVISIBLE.test(code) });
        }
      }
    } else {
      for (const m of run.consoleMessages) {
        if (!/[Cc]ookie|storage/i.test(m.text)) continue;
        const nm = (m.text.match(/“([^”]*)”/) || [])[1] || null;
        add({ ...base, kind: 'console', setCookie: (r.setCookie || []).find((l) => nameOf(l) === nm) || (r.setCookie || []).join(' | '), cookieName: nm, pageUrl: norm(r.pageUrl + '/page', PS, PH), requestUrl: null, text: norm(m.text, PS, PH), category: m.category });
      }
    }
  }
  return fx.filter((e) => e.text != null || e.kind === 'devtools-issue').map(({ _k, ...e }) => e);
}

(async () => {
  const PS = Number(process.env.PS) || ((await portFree(8443)) ? 8443 : await freePort());
  const PH = Number(process.env.PH) || ((await portFree(8080)) ? 8080 : await freePort());
  const tls = makeCert();
  const servers = [https.createServer(tls, handler('https')).listen(PS, '127.0.0.1'), http.createServer(handler('http')).listen(PH, '127.0.0.1')];
  const all = scenarios(PS, PH).filter((s) => !process.env.ONLY || new RegExp(process.env.ONLY).test(s.id));
  const s12 = all.filter((s) => s.id.startsWith('s12'));
  let results = [], strings = null;
  try {
    if (which === 'chrome' || which === 'both') {
      const r = await runChromeVariant('chrome', all, PS, PH); results = results.concat(r.results); strings = r.strings;
      for (const v of ['chrome-3pcd-flag', 'chrome-cookie-controls']) if (s12.length) results = results.concat((await runChromeVariant(v, s12, PS, PH)).results);
    }
    if (which === 'firefox' || which === 'both') {
      results = results.concat(await runFirefoxVariant('firefox', all, PS, PH));
      if (s12.length) results = results.concat(await runFirefoxVariant('firefox-cookieBehavior1', s12, PS, PH));
    }
  } finally {
    servers.forEach((s) => s.close());
  }
  const file = path.join(OUT, process.env.OUTFILE || 'results.json');
  fs.writeFileSync(file, JSON.stringify({ ports: { https: PS, http: PH }, devtoolsStrings: strings, results }, null, 2));
  console.log('wrote', file, results.length, 'entries');
  if (WRITE_FIXTURE) {
    const fx = buildFixture(results, strings || { ui: null, md: {} }, PS, PH);
    const ff = path.join(ROOT, 'test', 'fixtures', 'cookie-messages.json');
    fs.writeFileSync(ff, JSON.stringify(fx, null, 2) + '\n');
    console.log('wrote', ff, fx.length, 'entries');
  }
})().catch((e) => { console.error(e); process.exit(1); });
