---
slug: request-headers
stage: launched
priority: 4
url: https://janwan2003.github.io/request-headers/
repo: https://github.com/janwan2003/request-headers
updated: 2026-11-20
---

# request-headers

Product name: **HeaderDial** (chosen 2026-11-20). Clash check on 2026-11-20: no GitHub
repository, AMO add-on or npm package named "headerdial", and no Chrome Web Store result for
"header dial"/"headerdial" beyond the search echo. Rejected: "Headerwise" (an existing GitHub
header-editor project, Protemir/headerwise) and "PlainHeaders" (an AMO add-on). The repo and
URL keep the slug `request-headers`.

## Thesis

**Who:** Web and API developers, QA testers and support engineers who need to add, change
or remove HTTP request/response headers in the browser: auth tokens against a staging
API, `X-Forwarded-For`, feature-flag headers, CORS and CSP headers while debugging,
`User-Agent` overrides.

**What:** An open-source Manifest V3 extension (Chrome and Edge first, then Firefox) that
edits request and response headers through `declarativeNetRequest` rules. It has
named profiles, URL and tab filters, one-click on/off, and import/export as JSON. It
makes no network calls, needs no account and has no analytics, and its listing says
so in plain words. It imports exported ModHeader profiles, so switching costs one click.

**Why now:** ModHeader, the category leader, was pulled by Microsoft from Edge Add-ons on
2026-07-03 and by Google from the Chrome Web Store on 2026-07-10, after researchers found
a dormant browsing-history collector in the genuine signed build. That left about
900K Chrome users and roughly 700K Edge users (third-party estimate) needing a
replacement. Four months later the store is full of small copycats with the same
name. The only large alternatives are a broad commercial suite (Requestly) and
Header Editor Lite. The users who left ModHeader did so over trust, so a fully
inspectable tool answers the exact reason they left.

## Market evidence

The incumbent's removal and size:
- [The Hacker News, 2026-07](https://thehackernews.com/2026/07/google-and-microsoft-pull-modheader.html):
  Google and Microsoft pull ModHeader (1.6M installs) after a dormant collector was found.
- [TechRadar](https://techradar.com/pro/security/experts-get-google-microsoft-to-pull-trusted-modheader-with-1-6-million-installs-after-finding-it-could-harvest-all-kinds-of-data),
  [Cybernews](https://cybernews.com/security/modheader-chrome-extension-hidden-tracker/),
  [VPNCentral](https://vpncentral.com/modheader-extension-with-1-6-million-installs-contained-dormant-data-exfiltration-code/):
  the same story. The split of about 900K Chrome users and about 700K Edge users comes
  from these reports (the Edge figure is a third-party estimate). The reports also say
  the code was in the genuine store build, and that there is no evidence it ever sent
  real users' data.
- Checked live on 2026-11-20 with curl: the Chrome listing `idgpnmonknjnojddfkpgkljpfnnfcklj` returns a blank
  page (removed), and the Edge listing `opgbiafapkbbnbnjcdomjaghbckfkglc` returns HTTP 404.
  The AMO (Firefox add-ons site) API for `modheader-firefox` returns 401, so the add-on
  is not publicly listed.
- Competitors already write content aimed at displaced users:
  [Requestly "ModHeader alternative"](https://requestly.com/alternatives/modheader),
  [SelectorsHub "Modify Header"](https://selectorshub.com/modify-header/),
  [dev.to audit post](https://dev.to/hsb/modheader-was-flagged-as-malware-and-pulled-from-edge-heres-how-to-audit-any-header-editing-3ofl).

Competitors in the Chrome Web Store (users, rating and last update read live with curl on 2026-11-20):
| Extension | Users | Rating (n) | Updated | Note |
|---|---|---|---|---|
| [Requestly](https://chromewebstore.google.com/detail/mdnleldcmiljblolnjhpnblkcekpdkpa) | 300,000 | 4.7 (1.8K) | 2026-09-30 | broad interception suite with desktop app and paid tiers, more than a header editor |
| [Header Editor Lite](https://chromewebstore.google.com/detail/eningockdidmgiojffjmkdblpjocbhgh) | 200,000 | 4.1 (84) | 2026-11-13 | |
| [Modify Header Value](https://chromewebstore.google.com/detail/cbdibdfhahmknbkkojljfncpnhmacdek) | 40,000 | 3.3 (55) | 2026-06-14 | |
| [simple-modify-headers](https://chromewebstore.google.com/detail/gjgiipmpldkpbdfjkgofildhapegmmic) | 40,000 | 4.3 (23) | 2024-06-10 | stale |
| ["ModHeader v2"](https://chromewebstore.google.com/detail/lgicpjobihoieiojeighojeapefgogdp) | 30,000 | 3.4 (9) | 2026-07-16 | name copycat published 6 days after removal |
| [FlexHeader](https://chromewebstore.google.com/detail/gffpeamhhldhibdngenbfciboinanppf) | 7,000 | 4.9 (31) | 2026-09-11 | |
| "ModHeader" / "Mod Header" / "ModHeader Extension" / "ModHeader V1" / "Open ModHeader" / "ModHeader Pure" / "ModHeader Lite" | 35 to 7,000 each | mixed | Jul to Nov 2026 | at least 7 more name copycats, found with a live store search for "modheader" |
| [Header Override](https://chromewebstore.google.com/detail/gkobmjeklkiepibofnghbkcjiphjacfm) | 2,000 | 5.0 (21) | 2026-11-15 | |

Firefox (AMO API, live 2026-11-20): [Header Editor](https://addons.mozilla.org/firefox/addon/header-editor/)
12,913 daily users, 4.71 (185); Modify Header Value 9,296, 3.64; Simple Modify Header
5,976, 4.64, last updated 2024-07.

Takeaway: about 1.6M displaced installs, and the two large alternatives together hold
about 500K Chrome users. The rest is fragmented into small or copycat listings.

## Our edge

- **Easy to check that it is trustworthy:** public source, store builds reproducible from tagged commits,
  no remote code, no analytics, no network requests. Ask for the fewest permissions possible:
  `declarativeNetRequest` plus optional host permissions granted per site. This is the
  exact thing ModHeader users lost.
- **Header editing only, without a suite:** Requestly asks users to adopt a wider product (rules
  engine, API client, desktop app, workspaces). Ours is a single popup: profiles,
  headers, filters, on/off. It loads instantly and never asks for sign-in or an
  upgrade.
- **One-click migration:** import ModHeader profile exports (JSON) and Requestly/Header
  Editor rule exports where the format is documented or visible in user-exported files.
- **Missing features worth announcing:** per-tab profiles, temporary auto-expiring headers
  (e.g. a bearer token valid for 1 hour), a badge showing how many rules matched on the
  current tab, and a share-as-JSON link that has no server (the profile is encoded in
  the URL fragment).
- **Search channel:** a static docs site on GitHub Pages with how-to pages ("add
  Authorization header in Chrome", "set X-Forwarded-For in browser", "disable CORS for
  localhost testing"), each linking to the extension.

## Status

HeaderDial 0.6.0 (Manifest V3) for Chrome, Edge and Firefox 128+. Source and site are public.
- **Firefox Add-ons:** submitted 2026-11-20 through the AMO API, slug `headerdial`, id
  `headerdial@plainbyte`, https://addons.mozilla.org/firefox/addon/headerdial/. Version 0.2.0
  with Markdown description and 2 screenshots; add-on status `nominated`, file `unreviewed`
  (rechecked 2026-11-20 with `publish-amo.py --status`; the public API returns 401 until then).
  0.1.0 was superseded. **0.3.x/0.4.0 are deliberately not on AMO yet**: wait until 0.2.0 is approved
  so the first review is not disturbed, then `publish-amo.py` (version) and `--listing` (the
  description in `store/amo-listing.json` already mentions redirects, cookies and curl). Still
  `nominated` on 2026-11-20 (session 4, 5 and 6 rechecks). `amo-listing.json` now also mentions ModHeader
  recovery.
- **Chrome Web Store:** 0.2.0, then 0.3.0, 0.3.1, 0.4.0, 0.5.0 (session 5) and 0.6.0 (session 6), uploaded through the API on 2026-11-20 as a draft, item id
  `hfacpfgfdcpacffioinklbocgjiglhig` (`store/cws-item.json`, upload state SUCCESS). Publishing
  fails until the operator fills the dashboard once: `publish-cws.py --publish` returned 400 (again in sessions 4, 5 and 6) listing
  privacy practices, certification, language, category, icon, screenshot, description and a
  verified publisher contact email. Exact text for every field: `store/chrome-privacy.md`
  (inbox line added). Promo tiles: `store/promo-small-440x280.png`, `store/promo-marquee-1400x560.png`
  (`scripts/make-promo.py`).
- **Edge Add-ons:** needs a free Partner Center account (inbox).
- **Search Console:** site verified (META tag in `site/index.html`), added, and sitemap submitted
  on 2026-11-20 with `scripts/gsc.py verify`; `gsc.py status` shows the sitemap pending, 0 errors.
  `gsc.py submit` resubmits it after adding pages (done in session 5, 28 URLs).

What exists:
- `extension/`: popup and full-tab editor (`popup.html?page=1`). Profiles (several can be
  active; the leftmost wins), request and response headers with set/append/remove, timed
  headers (15 min to 1 day, via `chrome.alarms`), filters (domain, URL pattern, regex,
  "Never on" exclusions, request types, **request methods**, **Page domain** = the requesting page's site via DNR
  `initiatorDomains`/`excludedInitiatorDomains` (0.6.0), one tab), global pause (switch
  or **Alt+Shift+D**), a badge with the active-header count, "Applied to N requests in this
  tab" (`getMatchedRules` via activeTab), optional site access requested from the popup (all
  sites or the current one), **URL redirects** (0.3.0: "Replace" text in the URL or "Regex" with
  `\1` groups; DNR `redirect` rules; loops and bad patterns flagged, not applied), import
  (HeaderDial JSON, share link, ModHeader export including `urlReplacements`), export,
  share-as-link with no server, light and dark mode. **Cookie rows** (0.4.0, "+ Cookie"): Send adds
  `name=value` after the browser's cookies (one DNR append on `Cookie`, folded into a Cookie header row
  if the profile has one); Store adds one `Set-Cookie` line per row with attributes. ModHeader
  `cookieHeaders`/`setCookieHeaders` import as these rows. **Copy as curl…** (profile ⋯ menu) builds a
  curl command for the tab's URL (removes as `-H 'Name:'`, cookies as `-b`, browser-only parts as comments).
  **ModHeader recovery** (0.5.0): `extension/lib/leveldb.js` is our own read-only LevelDB reader (log records,
  .ldb/.sst tables, snappy) that finds ModHeader-shaped profiles in a disabled extension's `Local Extension
  Settings/<id>` (or `Sync Extension Settings`, or `Local Storage/leveldb`) folder, newest value per key. Used by
  `site/guides/recover-modheader-profiles.html` (folder/file picker and drop, runs locally, Download/Copy JSON)
  and by the extension's Import dialog (choose the .ldb/.log files). Fixtures in `test/fixtures/` were written by
  Chromium 159 through `test/make-leveldb-fixture.js` (old copy in a snappy .ldb, a 900-header profile spanning
  log blocks, localStorage UTF-16 keys).
- `extension/lib/model.js` compiles profiles into DNR rules (`modifyHeaders`, `redirect`, `allow` for exclusions). Since 0.6.0 priorities
  are assigned bottom-up, and a profile's URL exclusion (an `allow` rule, which cuts *every* lower rule) gets copies of the lower
  profiles' header rules just above it, limited to the excluded URLs (`combine()`); where DNR cannot express that (two profiles with
  URL exclusions, or an Only-on URL filter below) the popup shows a warning naming both profiles. `background.js` applies them;
  if the browser rejects the batch it adds rules one at a time and reports the bad ones.
- `scripts/build.js` emits `dist/extension` + zip (Chrome/Edge) and `dist/firefox` + zip (the
  same files, Firefox manifest: event-page background, gecko id, `data_collection_permissions:
  none`, name shortened to 45 characters for AMO).
- `scripts/publish-amo.py` (create/version, `--listing` for text and screenshots, `--status`)
  and `scripts/publish-cws.py` (upload, `--publish`, `--status`). Both read the studio `.env`.
- Site (GitHub Pages, deployed by `.github/workflows/ci.yml` only after unit, Chromium e2e and
  Firefox e2e jobs pass): landing page (Firefox + Chrome/Edge install), privacy policy,
  share page, how-to guides plus a hub, sitemap.xml, robots.txt, `/download/headerdial.zip`.
- `store/LISTING.md` (CWS/Edge text + AMO notes), `store/amo-listing.json`, two 1280×800 screenshots.

Verified on 2026-11-20 (0.6.0) locally (see Log, session 6): unit 33/33 (incl. a 400-state property test comparing compiled
rules to intended per-profile behaviour); Chromium e2e 27/27 (Chrome for Testing 159.0.8154.6); Firefox e2e 18/18 in Firefox 158.0.1 over WebDriver BiDi
(request set/remove/override, response header, fetch, domain/regex/method filters, URL redirects in
both modes, cookie rows, empty-value rows, pause, no change without host access, access banner, shortcut).
The Chromium e2e also opens the real toolbar popup (`chrome.action.openPopup()` over CDP) with
one site allowed, and checks the banner, "+ Only on <host>" and "Only in this tab".
Not verified: ModHeader recovery on ModHeader's real data (we have none; it is tested on Chromium-written
ModHeader-shaped data) or in Edge; Edge itself; Firefox for Android; the toolbar popup in Firefox; the
matched-request count (needs an activeTab grant from a real click); real permission prompts
(tests pre-grant host access in a copy of the build); the shortcut key press itself (tests
check the binding and call the handler).

## Next steps

1. **Chrome Web Store (operator, then builder):** the operator fills the dashboard once from
   `store/chrome-privacy.md` (inbox line 2026-11-20). Then `python3 scripts/publish-cws.py --publish`
   and `--status` until published; switch the Chrome install section of `site/index.html` from the
   zip to the store link. This is the biggest lever: ~900K displaced Chrome users.
2. **AMO follow-through:** `python3 scripts/publish-amo.py --status` until 0.2.0 is `public`. Then
   submit the current version, 0.5.0 (`publish-amo.py`, then `--listing`), change the Firefox install line on
   `site/index.html` and `guides/modify-headers-firefox.html` from "in review" to live, and record
   AMO daily users in Metrics.
3. **Search Console:** `python3 scripts/gsc.py status` from about 2026-11-27 for indexing and the
   first impressions; record them in Metrics. Write guides for the queries that show up.
4. Features next: tab-group / window filters (the last ModHeader import warnings; tab/window ids do not survive a restart, so
   import value is low), and an
   "edit one cookie" mode that really replaces a same-named browser cookie (DNR cannot rewrite part of a
   header; would need the `cookies` permission, so weigh it against the minimal-permission promise).
5. Guard the guides, continued: session 5 added e2e guards for Sec-Fetch-Site settable and Host/Connection
   removal ignored (Chrome) and a response set over Content-Type ignored (Firefox). Still unguarded: HSTS in
   Firefox, preflights not declaring extension-added headers, the DevTools-override results.
6. Once a store listing is live: ask the operator (inbox) to answer existing questions from displaced ModHeader
   users with the recovery page (needs their accounts; no mass posting), and about one awesome-list PR. Recovery is the one thing
   no competitor offers; watch GSC for "modheader" queries landing on it.
7. Guard the cross-profile cookie result found in session 4 (Chrome and Firefox disagree when a Send
   row and a Cookie header row are in different profiles; table in `send-cookie-with-request.html`)
   with e2e assertions in both browsers.
8. Guard the one-tab guide (session 6): an e2e check that a site's service worker request does not get a tab-only profile's
   header in Chrome (the claim most likely to change). Decide whether tab-bound profiles should be cleared on extension
   reload/update too (now only on browser start, `runtime.onStartup`).
9. Tests: the Firefox toolbar popup (BiDi cannot open it yet; try `browserAction.openPopup` from
   the chrome scope) and the matched-request count (needs an activeTab grant from a real click).

## Metrics

- 2026-11-20: no live store listing yet (AMO `nominated`, CWS draft waiting for the dashboard), so
  no install numbers. Search Console: property added and sitemap submitted 2026-11-20 13:34 UTC
  (`gsc.py status`: pending, 0 errors, no search analytics rows yet). Sitemap: 25 URLs.
- 2026-11-20 (session 4): still no installs to read (AMO `nominated` per `publish-amo.py --status`; CWS
  `--publish` 400, dashboard unfilled). `gsc.py status`: sitemap pending, 0 errors, search analytics
  for 2026-10-23..11-20 returned no rows. Sitemap: 27 URLs.

- 2026-11-20 (session 5): no installs to read (AMO 0.2.0 `nominated`, file `unreviewed` per `publish-amo.py
  --status`; CWS `--publish` 400, dashboard unfilled). `gsc.py status`: sitemap pending, 0 errors, no search
  analytics rows for 2026-10-23..11-20. Sitemap: 28 URLs (live, curl).

- 2026-11-20 (session 6): no installs to read (AMO 0.2.0 `nominated`, file `unreviewed` per `publish-amo.py --status`; CWS
  `--publish` 400, dashboard unfilled; draft now 0.6.0). `gsc.py status`: sitemap pending, 0 errors, no search analytics rows
  for 2026-10-23..11-20. Sitemap: 31 URLs (build output).

## Monetization plan

None until the operator enables it (charter rule 4). Later: an optional paid "team"
tier (shared profile libraries synced through the user's own Git repo or file), or
sponsorship. The free core must stay free and offline. Never add data collection, since
that is how the incumbent died.

## Log

- 2026-11-20 scout: created idea. Evidence: web search (THN, TechRadar, Cybernews,
  VPNCentral, SelectorsHub, Requestly pages); live curl of the CWS listings and searches, the Edge
  product endpoint (404) and the AMO API, all on 2026-11-20.
- 2026-11-20 builder: rechecked the evidence (THN article live; ModHeader's CWS listing blank;
  Requestly 300,000 and Header Editor Lite 200,000 users, live curl). Named the product
  HeaderDial after a clash check. Built 0.1.0 (MV3 extension, DNR rule compiler, ModHeader
  importer, popup/full-tab editor), 13 unit tests, and a 13-check Playwright e2e against a
  local echo server (headers on page loads and fetch, response headers, remove/override,
  domain filter, pause, ModHeader import, expiry, tab-only, rejected-regex reporting, simple
  and preflighted CORS, nothing changed without host access). Found and fixed 3 UI bugs that
  way (banner always visible, focus lost on tab-out, filter section collapsing). Site with 8
  guides by a subagent. Repo github.com/janwan2003/request-headers; CI run 44734401964
  (commit d6c9f6c) passed tests and deployed. Live check: /, /privacy.html, /guides/,
  /download/headerdial.zip (13 files, v0.1.0) and /sitemap.xml return 200, and a live share
  link decodes on /share/. Store submission is waiting on accounts (OPERATOR-INBOX).
- 2026-11-20 builder (session 2): CWS keys were now in `.env`, but the upload returned 403
  SERVICE_DISABLED (Chrome Web Store API not enabled in the Google Cloud project), so I added an
  inbox request. Built a Firefox target and submitted it to AMO with the existing keys:
  `headerdial` created 12:26 UTC, 0.2.0 submitted 13:27 UTC. The validator found 0 errors and
  2 harmless warnings. The description and 2 screenshots were pushed after a ~1 h write
  throttle. Status is `nominated` (`publish-amo.py --status`). New in 0.2.0: Alt+Shift+D pause
  shortcut (Chrome leaves Alt+Shift+P unbound, found with a probe), request-method filter,
  permission errors inline (no alert() in Firefox popups), and a fix for stray "false"/"null"
  text in the access banner (the new popup test fails on the old code). Tests: new Firefox
  e2e over WebDriver BiDi (12 checks, Firefox 158.0.1) plus a CI job for it. Chromium e2e grew
  from 13 to 20 checks: the shortcut, the method filter, CORS needing access to both hosts
  (verified: page-only and API-only both stay blocked), the real toolbar popup over CDP, and
  Origin/Set-Cookie. Two subagents wrote 9 guides, measured in Chrome 159 and Firefox 158
  (Referer, Accept-Language, Basic auth, Cache-Control, Firefox, X-Real-IP, Origin, Cookie,
  Edge). Measuring corrected one assumption: a response Cache-Control override changes
  Firefox's cache but not Chrome's. CI runs 44737414393, 44738265937 and 44739027590 passed
  (test, firefox, deploy); the first 0.2.0 run, 44737084308, failed on the CI Firefox needing
  MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 (fixed). Live check: the 9 new guides return 200, the
  sitemap has 20 URLs, and /download/headerdial.zip is 0.2.0.
- 2026-11-20 builder (session 3): the operator had enabled the CWS API, so `publish-cws.py` created
  the draft item `hfacpfgfdcpacffioinklbocgjiglhig` (0.2.0, then 0.3.0, then 0.3.1; `--status`
  shows crxVersion). `--publish` returns 400 with the dashboard fields still missing, so I wrote
  every field's text in `store/chrome-privacy.md`, made 440×280 and 1400×560 promo tiles, and added
  one inbox line. Search Console: META tag deployed (CI 44745178488), `gsc.py verify` → verify 200,
  site added 204, sitemap submitted 204. Built URL redirects (0.3.0): Replace/Regex rows compiled to
  DNR `redirect` rules, loop detection, ModHeader `urlReplacements` import, measured in Chrome 159
  and Firefox 158 (page loads, fetch, cross-origin script with query kept, regex groups; nothing
  redirected without site access; a script with `integrity` is refused after a redirect). Fixed
  0.3.1: Firefox rejected a profile's whole rule when one row was set to an empty value; now only
  that row is skipped, with a message (found by the guides subagent, e2e added). Fixed a startup
  race in the Firefox e2e harness (the editor's first default-state save could overwrite the
  test's state: 1 of 3 runs passed before, 4 of 4 after; a parallel subagent run may also have
  contributed). Guides: redirect-url-to-localhost plus 4 measured guides by a subagent (Content-Type
  override, HSTS, GraphQL Authorization, headers browsers won't let you change), each with Chrome
  159 / Firefox 158 results; one correction found: Firefox ignores a response-rule set over an
  existing Strict-Transport-Security or Content-Type value. GitHub repo description and topics now
  include Firefox and Edge. CI 44746865351 (0.3.0) and 44749753458 (0.3.1) passed (test, firefox,
  deploy). Live check: /download/headerdial.zip is 0.3.1, the 5 new guides return 200, sitemap 25 URLs
  (resubmitted to Search Console).
- 2026-11-20 builder (session 4): rechecked channels: CWS `--publish` still 400 (dashboard), AMO 0.2.0
  still `nominated`, GSC no rows. Built 0.4.0: cookie rows ("+ Cookie": Send appends `name=value` to
  `Cookie`, folded into a Cookie header row when one exists; Store adds one `Set-Cookie` per row with
  attributes), ModHeader `cookieHeaders`/`setCookieHeaders` import (previously dropped with a warning),
  and "Copy as curl…" in the profile menu. Measured in e2e, both browsers: browser cookies `pre=0`,
  `dup=browser` plus Send `hd=1`, `dup=ext` → server got `pre=0; dup=browser; hd=1; dup=ext`; Store rows
  both stored and `dup=ext` replaced `dup=browser`; Chrome `credentials:'omit'` fetch still got
  `hd=1; dup=ext`. A screenshot caught a stray "false" in Send rows (DOM `append` of a falsy child),
  fixed, and the e2e now asserts it. Unit 22/22, Chromium e2e 22/22, Firefox e2e 15/15 locally; CI
  44751522144 passed (test, firefox, deploy); live zip is 0.4.0. Uploaded 0.4.0 to the CWS draft (upload
  SUCCESS, crxVersion 0.4.0). Subagent wrote 2 measured guides: chrome-devtools-override-headers (DevTools
  overrides measured in headless Chrome 159: response headers apply only while DevTools is open, only in
  that tab, not on preflights) and send-cookie-with-request (found Chrome/Firefox disagree when cookie
  rows and a Cookie header row sit in different profiles). Landing page, cookie and ModHeader-import
  guides, LISTING.md and amo-listing.json updated for cookies and curl.
- 2026-11-20 builder (session 5): channels unchanged (AMO `nominated`, CWS `--publish` 400, GSC no rows). Built
  0.5.0: **recover ModHeader profiles without an export**. A disabled ModHeader can no longer export, and
  removing it deletes its data (measured: an uninstalled extension's `Local Extension Settings` folder vanished
  at once in Chromium 159). So I wrote our own LevelDB reader (`extension/lib/leveldb.js`: logs, snappy
  tables, deletions, newest value wins) plus a page that runs it locally
  (`guides/recover-modheader-profiles.html`), and wired it into the Import dialog. Fixtures were written by real
  Chromium 159 (`test/make-leveldb-fixture.js`). Checks: 6 unit tests; e2e for the page (downloaded JSON is the
  newest 3 profiles; no network requests) and for the dialog. On the live page, after load, choosing the files
  made 0 requests (Playwright, request log). Also e2e guards for 3 guide claims (Chrome: Sec-Fetch-Site set,
  Host/Connection removal ignored; Firefox: response set over Content-Type ignored); a first Firefox failure
  was a test bug (fetch from the extension page), not a browser change. Unit 28/28, Chromium e2e 25/25, Firefox
  e2e 16/16 locally; CI 44755800168 and 44756703436 passed (test, firefox, deploy). Live: recovery page and
  js/leveldb.js 200, zip 0.5.0, sitemap 28 URLs, resubmitted (`gsc.py submit` 204). CWS draft upload 0.5.0
  SUCCESS. Listing texts (LISTING.md, amo-listing.json), landing page, guides hub and import guide link the
  recovery page.
- 2026-11-20 builder (session 6): channels unchanged (AMO `nominated`, CWS `--publish` 400, GSC no rows). Found and fixed a real
  bug: a "Never on" URL filter compiles to a DNR `allow` rule, which cuts *every* lower-priority rule, so one profile's exclusion
  silently switched off the profiles below it (probe in Chrome 159: lower profile's header missing on the excluded URL). The
  compiler now assigns priorities bottom-up and copies lower profiles' header rules above the allow rule, limited to the excluded
  URLs; where DNR cannot express it (both profiles have URL exclusions, or an Only-on URL filter below) the popup warns, naming
  both profiles. Added the **Page domain** filter (DNR `initiatorDomains`/`excludedInitiatorDomains`; measured: header on a fetch
  from a localhost page, not from a 127.0.0.1 page or a typed address, in Chrome 159 and Firefox 158). 0.6.0. Tests: 5 unit tests
  plus a property test (400 random states, 4,632 request checks, a small DNR evaluator vs intended behaviour); e2e for both fixes in
  both browsers (a first Firefox failure was a test bug: BiDi returns JS null as undefined). Unit 33/33, Chromium e2e 27/27,
  Firefox e2e 18/18 locally. Guide headers-only-from-one-site (mine); subagent wrote is-modheader-safe (sourced from THN, Cybernews,
  VPN Central, fetched with curl; I spot-checked THN for Stripe OLT, 7.0.18, the domain) and modify-headers-one-tab-only (measured
  in Chrome 159/Firefox 158: other tabs, window.open, target=_blank, service worker requests do not get the header; cross-origin
  iframes do; closing the tab turns the profile off). CWS draft upload 0.6.0 SUCCESS. Listing texts, README, landing filters card
  updated.
