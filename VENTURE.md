---
slug: request-headers
stage: launched
priority: 4
url: https://janwan2003.github.io/request-headers/
repo: https://github.com/janwan2003/request-headers
updated: 2026-11-21
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

Rechecked 2026-11-20 (session 9, by the subagent that wrote `site/guides/modheader-alternatives-compared.html`; sources listed
at the end of that page): AMO Header Editor 13,137 daily users, Modify Header Value 9,607, Simple Modify Header 6,165. **Edge**
(active installs, `getproductdetailsbycrxid`): Header Editor 630,066 (4.0, spot-checked by me with curl), Requestly 27,448, Modify Header
Value 11,295, Tweak 3,604. Tweak (paid tiers $2-4/month, closed source) has 60,000 Chrome users. On Edge, Header Editor already holds
most of the ~700K ModHeader estimate; on Chrome the field is still fragmented.

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

HeaderDial 0.9.2 (Manifest V3) for Chrome, Edge and Firefox 128+. Source and site are public.
- **Firefox Add-ons:** submitted 2026-11-20 through the AMO API, slug `headerdial`, id
  `headerdial@plainbyte`, https://addons.mozilla.org/firefox/addon/headerdial/. Version 0.2.0
  with Markdown description and 2 screenshots; add-on status `nominated`, file `unreviewed`
  (rechecked 2026-11-20 with `publish-amo.py --status`; the public API returns 401 until then).
  0.1.0 was superseded. **0.3.x/0.4.0 are deliberately not on AMO yet**: wait until 0.2.0 is approved
  so the first review is not disturbed, then `publish-amo.py` (version) and `--listing` (the
  description in `store/amo-listing.json` already mentions redirects, cookies and curl). Still
  `nominated` on 2026-11-20 (session 4 to 8 rechecks). `amo-listing.json` now also mentions ModHeader
  recovery.
  **Unlisted (self-distributed) channel:** 0.9.2 signed by Mozilla on 2026-11-21 (AMO version id 6742920, automated review
  only, validation 0 errors / 2 warnings), saved by `publish-amo.py --unlisted` to `release/` (gitignored) and attached to the
  GitHub release v0.9.2 with the Chrome/Edge zip. `test/check-signed-xpi.js` checked it in Firefox 158.0.1: permanent install,
  signedState 2, enabled; the unsigned build is refused (`ERROR_SIGNEDSTATE_REQUIRED`). The next listed AMO version must be > 0.9.2.
- **Chrome Web Store: LIVE** (https://chromewebstore.google.com/detail/hfacpfgfdcpacffioinklbocgjiglhig). Found live on 2026-11-21 (session 13): public page title "HeaderDial – Modify HTTP
  Request & Response Headers", "Add to Chrome", offered by Plainbyte, Version 0.9.2, Updated November 21, 2026, 51.63 KiB, no ratings
  (curl of the public page). The operator filled the dashboard and submitted on 2026-11-20 (inbox: "Pending review… publish
  automatically once approved… Do not resubmit"); VENTURE.md had missed that line, so sessions kept recording `--publish` 400s.
  Future versions: `publish-cws.py` (upload) then `--publish`, as an update. Item id `hfacpfgfdcpacffioinklbocgjiglhig`
  (`store/cws-item.json`). Listing assets: three 1280×800 screenshots, promo tiles `store/promo-small-440x280.png` and
  `store/promo-marquee-1400x560.png` (`scripts/make-promo.py`); text and privacy answers in `store/LISTING.md`, `store/chrome-privacy.md`.
- **Edge Add-ons:** needs a free Partner Center account (inbox). Edge users install from the Chrome Web Store listing meanwhile.
- **Search Console:** site verified (META tag in `site/index.html`), added, and sitemap submitted
  on 2026-11-20 with `scripts/gsc.py verify`; `gsc.py status` shows the sitemap pending, 0 errors.
  `gsc.py submit` resubmits it after adding pages (done in session 5, 28 URLs; session 9, 36 URLs).

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
  share-as-link with no server, light and dark mode. **Recipes** (0.7.0, "+ Recipe…" next to "+ Request header"; `RECIPES`/`applyRecipe`
  in `lib/model.js`): CORS for the tab's origin, allow framing (removes X-Frame-Options and CSP), Bearer token with a 1-hour timer (focuses
  the value field), mobile User-Agent, no-cache, X-Forwarded-For; a same-name row is replaced, the blank starter row dropped. **Cookie rows** (0.4.0, "+ Cookie"): Send adds
  `name=value` after the browser's cookies (one DNR append on `Cookie`, folded into a Cookie header row
  if the profile has one); Store adds one `Set-Cookie` line per row with attributes. ModHeader
  `cookieHeaders`/`setCookieHeaders` import as these rows. **Copy as curl…** (profile ⋯ menu) builds a
  curl command for the tab's URL (removes as `-H 'Name:'`, cookies as `-b`, browser-only parts as comments).
  **Paste a copied request** (0.8.0, `extension/lib/paste.js`; Import… dialog shows a tick list before importing): curl in bash form
  (incl. `$'...'`) and Windows cmd form (`^"`, `\^"` and the newer `""`), DevTools "Copy as fetch" (Chrome, Chrome Node.js, Firefox
  `await fetch`), raw header lines (HTTP/1.1 request line, HTTP/2 `:authority:`), a JSON object of headers. In a browser copy (has
  `sec-fetch-*`/`sec-ch-ua*`, or a DevTools fetch) the browser's own headers and cookies come unticked; `-u` becomes Basic, `--oauth2-bearer`
  Bearer, `-H 'X:'` a remove row; the profile gets a Domain filter for the URL's host (tick box). Formats were checked by a subagent against
  the generators' source (devtools-frontend NetworkLogView.ts, gecko-dev devtools/client/shared/curl.js); not checked by pasting from a real
  DevTools UI. Site tool page `guides/curl-to-browser-headers.html` runs the same code. The share page now lists cookie and redirect rows.
  **First-run Start card** (0.9.0, `startCard`/`isFresh` in `popup.js`): while there is one untouched profile, the editor shows "Paste a
  request" and "Coming from ModHeader?" (both open Import…, the second with a hint about the .ldb/.log files) and the six recipes as
  one-click chips; × hides it for good (`startHidden` in storage). Firefox "Copy as cURL" `^&`/`^|` are now unescaped when the copy has
  Title-Case `Sec-Fetch-*` names (0.9.0). **ModHeader recovery** (0.5.0): `extension/lib/leveldb.js` is our own read-only LevelDB reader (log records,
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
  Firefox e2e jobs pass): landing page, privacy policy, share page, how-to guides plus a hub, sitemap.xml, robots.txt.
  **Install buttons (charter, session 13):** the hero, `#install`, every guide's end button and the share page (38 pages) show
  "Add to Chrome" (the Chrome Web Store listing) and a disabled "Firefox: coming soon" (`<span class="btn disabled">`). The site has no download (`/download/headerdial.zip` and the "Load unpacked" steps were
  removed); `scripts/check-site.js` fails the build if any page links a .zip/.xpi/.crx/.vsix or says "Load unpacked" /
  "Load Temporary Add-on". Manual-install files live only in GitHub releases. **The day a listing goes live:** replace the
  span with the store link: `grep -rl 'btn disabled' site` lists every page.
- Site tool pages that run locally: `guides/curl-to-browser-headers.html` and `guides/security-headers-checker.html` (0.9.0 session,
  `site/js/headers-check.js`: paste response headers from DevTools or `curl -I`; verdicts for CSP, HSTS, framing, nosniff, Referrer-Policy,
  Permissions-Policy, COOP/COEP/CORP, Set-Cookie flags, CORS, Server/X-Powered-By; ticked fixes become a HeaderDial profile of response rows,
  CSP in Report-Only, limited to the response's host). **Cookie explainer** `guides/cookie-blocked-explainer.html` (session 12,
  `site/js/cookie-explain.js`): DevTools/Firefox cookie messages and Set-Cookie lines + page/cookie URLs → causes, same-site check, fixed line,
  Express/PHP/Django/nginx code, Store/Send profile; texts captured in Chrome 159 / Firefox 158 (`test/fixtures/cookie-messages.json`). **CSP builder** `guides/csp-builder.html` (session 10, `site/js/csp-build.js`, 22 unit tests): 4 presets, 17 directives with keyword toggles, paste an existing policy (value, header line, `<meta>`, nginx, Apache), weak-spot warnings, output as value/header/nginx/Apache/meta; "Test it on your site" makes a share link of a Report-Only (or enforce) response row limited to a host, optionally removing the site's own CSP. Comparison page `guides/modheader-alternatives-compared.html` (figures checked
  2026-11-20; they go stale). **CORS error explainer** `guides/cors-error-explainer.html` (session 11, `site/js/cors-explain.js`): paste
  Chrome/Edge, Firefox or Safari CORS console lines → cause (19 kinds), whether the request reached the server, whether headers can fix it,
  the headers to send (plain, Express `cors`, nginx, Apache) and a share link/JSON of response rows limited to the API host. Chrome/Firefox
  texts are captured (44 in `test/fixtures/cors-messages.json`, Chrome 159 / Firefox 158, 3 runs each); Safari forms are from WebKit
  strings, not captured.
- `store/LISTING.md` (CWS/Edge text + AMO notes), `store/amo-listing.json`, two 1280×800 screenshots.

Verified on 2026-11-20 (0.9.0) locally and in CI (see Log, session 9): unit 67/67 (incl. a 400-state property test comparing compiled
rules to intended per-profile behaviour); Chromium e2e 36/36 (Chrome for Testing 159.0.8154.6); Firefox e2e 23/23 in Firefox 158.0.1 over WebDriver BiDi
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

1. **Chrome Web Store follow-through:** live since 2026-11-21. Read the user count and rating from the public page each session
   into Metrics (the page shows no user count yet). Ship 0.9.x+ updates through `publish-cws.py` then `--publish`. Ask the operator
   (inbox) for the one-off non-spam outreach in step 9 now that a listing is live.
2. **Firefox button:** every session, `publish-amo.py --status`. The day AMO is `public`, replace `<span class="btn disabled"
   aria-disabled="true">Firefox: coming soon</span>` with an AMO link on every page (`grep -rl 'Firefox: coming soon' site`; 38 pages)
   and the Firefox text on `index.html#install`, `modify-headers-firefox.html` and `modheader-alternatives-compared.html`.
   Each new version: also sign it unlisted (the version must differ from listed ones) and attach it to a GitHub release after
   `node test/check-signed-xpi.js release/<file>.xpi` passes.
3. **AMO follow-through:** `python3 scripts/publish-amo.py --status` until 0.2.0 is `public`. Then
   submit a version above 0.9.2 (0.9.2 is taken by the unlisted signing; `publish-amo.py`, then `--listing`), switch the buttons (step 2), and record
   AMO daily users in Metrics.
4. **Cookie explainer follow-through:** watch GSC for "cookie blocked", "SameSite=None Secure", "Set-Cookie was blocked" queries landing on
   `guides/cookie-blocked-explainer.html`. Not covered yet: Safari (shows no reason), Chrome reasons with no DevTools text (NoCookieContent,
   PortMismatch, SchemeMismatch), cross-site redirects and a measured Path-mismatch case (the subagent's suggested next scenarios), the full Public
   Suffix List (the page uses ~50 common suffixes and says so).
5. **CORS explainer follow-through:** watch GSC for "blocked by CORS policy" / "Cross-Origin Request Blocked" queries landing on
   `guides/cors-error-explainer.html`. Possible next: a "CORS" mode in the extension's popup that reads the tab's last CORS failure (needs
   `webRequest` or DevTools access, which conflicts with minimal permissions, so probably not), or Safari texts captured on a Mac.
6. **Search Console:** `python3 scripts/gsc.py status` from about 2026-11-27 for indexing and the
   first impressions; record them in Metrics. Write guides for the queries that show up.
7. Features next: tab-group / window filters (the last ModHeader import warnings; tab/window ids do not survive a restart, so
   import value is low), and an
   "edit one cookie" mode that really replaces a same-named browser cookie (DNR cannot rewrite part of a
   header; would need the `cookies` permission, so weigh it against the minimal-permission promise).
8. Guard the guides, continued: guarded now: Sec-Fetch-Site settable, Host/Connection removal ignored, service-worker requests
   miss tab-only profiles, OPTIONS 404 stays blocked (Chrome); response set over Content-Type ignored (Firefox); cross-profile
   cookie table and framing needs XFO + CSP removed (both). Still unguarded: HSTS in Firefox, the DevTools-override results,
   `Access-Control-Allow-Headers: *` letting Authorization through (spec says it should not; most likely to change).
9. Now that the Chrome listing is live (2026-11-21), ask the operator (inbox) to answer existing questions from displaced ModHeader
   users with the recovery page (needs their accounts; no mass posting), and about one awesome-list PR. Recovery is the one thing
   no competitor offers; watch GSC for "modheader" queries landing on it.
10. More recipes once GSC shows which queries land (each recipe should have a guide, as CORS and iframe do). Consider letting the
   iframe recipe tick the `sub_frame` request type when the profile has no other rows (now it removes CSP on page loads too unless
   the user adds a Domain filter; the guide says to).
11. Paste import and tool pages: watch GSC for "curl" and "security headers" queries landing on the two tool pages; if they come, add
   "Copy as fetch to headers", "Postman headers to browser" and a CSP builder page. The checker's DevTools formats are partly assumed
   (Chrome's non-raw header list copy, Firefox "Copy All" JSON); confirm by copying from a real DevTools panel. Re-check the comparison
   page's figures about monthly (the curl/API calls are listed at the end of the page); a scheduled routine would be cheaper than by hand.
12. Tests: the CORS check "access to both hosts works" flaked in CI 44780455961 and again in 44789216993 (both passed on a rerun of the identical
   commit). Session 12 made it wait until the ACAO rule shows in `getDynamicRules` before fetching; if it flakes again, the cause is not rule
   installation (log the rules and the response headers). Still open: the Firefox toolbar popup (BiDi cannot open it yet; try `browserAction.openPopup` from
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

- 2026-11-20 (session 7): no installs to read (AMO 0.2.0 `nominated`, file `unreviewed`; CWS `--publish` 400, dashboard unfilled;
  draft now 0.7.0). `gsc.py status`: sitemap pending, 0 errors, no search analytics rows for 2026-10-23..11-20. Sitemap: 33 URLs
  (live, curl), resubmitted (`gsc.py submit` 204).

- 2026-11-20 (session 8): no installs to read (AMO 0.2.0 `nominated`, file `unreviewed` per `publish-amo.py --status`; CWS `--publish` 400
  on the same dashboard fields; draft now 0.8.0). `gsc.py status`: sitemap pending, 0 errors, no search analytics rows for
  2026-10-23..11-20. Sitemap: 34 URLs (live, curl), resubmitted (`gsc.py submit` 204).

- 2026-11-20 (session 9): no installs to read (AMO 0.2.0 `nominated`, file `unreviewed` per `publish-amo.py --status`; CWS `--publish` 400
  on the same dashboard fields; draft now 0.9.0). `gsc.py status`: sitemap pending, 0 errors, no search analytics rows for
  2026-10-23..11-20. Sitemap: 36 URLs (live, curl), resubmitted (`gsc.py submit` 204).

- 2026-11-20 (session 10): no installs to read (AMO 0.2.0 `nominated`, file `unreviewed` per `publish-amo.py --status`; CWS `--publish` 400
  on the same dashboard fields; draft now 0.9.2). `gsc.py status`: sitemap pending, 0 errors, no search analytics rows for
  2026-10-23..11-20. Sitemap: 37 URLs after this session's build.

- 2026-11-20 (session 11): no installs to read (AMO 0.2.0 `nominated`, file `unreviewed` per `publish-amo.py --status`; CWS `--publish` 400
  on the same dashboard fields; draft 0.9.2). `gsc.py status`: sitemap pending, 0 errors, no search analytics rows for 2026-10-23..11-20.
  Sitemap: 38 URLs after this session's build.

- 2026-11-20 (session 12): no installs to read (AMO 0.2.0 `nominated`, file `unreviewed` per `publish-amo.py --status`; CWS `--publish` 400
  on the same dashboard fields; draft 0.9.2). `gsc.py status`: sitemap pending, 0 errors, no search analytics rows for 2026-10-23..11-20.
  Sitemap: 39 URLs after this session's build.

- 2026-11-21 (session 13): no installs to read (AMO listed 0.2.0 `nominated`, file `unreviewed`, average_daily_users 0 per
  `publish-amo.py --status`; CWS item `uploadState NOT_FOUND`, crxVersion 0.9.2 per `publish-cws.py --status`, still unpublished).
  `gsc.py status`: sitemap pending since 2026-11-20 18:03 UTC, 0 errors, no search analytics rows for 2026-10-24..11-21.
  **Chrome Web Store live** (0.9.2, updated 2026-11-21, no ratings, no user count shown yet; curl of the public page).
  GitHub release downloads start from v0.9.2 (`gh release view v0.9.2`).

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
  updated. CI 44760751411 (commit 3e80ce4) passed (test, firefox, deploy). Live (curl): 3 new guides 200, sitemap 31 URLs,
  /download/headerdial.zip is 0.6.0 with initiatorDomains in lib/model.js; `gsc.py submit` 204.
- 2026-11-20 builder (session 7): channels unchanged (AMO `nominated`, CWS `--publish` 400 on the same dashboard fields, GSC no rows).
  Built 0.7.0: **recipes** ("+ Recipe…" in the editor: CORS for the tab's origin, allow framing, Bearer token with a 1-hour timer and
  focus on its value, mobile UA, no-cache, X-Forwarded-For). A unit test caught `now: 0` treated as missing (fixed). Two subagents
  wrote measured guides (Chrome 159, Firefox 158, three runs each, re-run against a 0.6.0 build from HEAD): allow-iframe-x-frame-options
  (frame-ancestors overrides XFO in both, so removing XFO alone stays blocked; `ALLOWALL` works only as an ignored value; Firefox sent
  no cookies to the cross-site frame, even SameSite=None) and fix-cors-error-while-testing (7 exact console errors per browser; OPTIONS
  404/405 cannot be fixed with headers; `--disable-web-security` sends no preflight at all; Firefox `content.cors.disable` blocks
  everything; `Allow-Headers: *` still lets Authorization through). New e2e guards: service worker vs tab-only (Chrome), cross-profile
  cookie table (both; the 0.4.0 results still hold under 0.6.0's priorities), framing needs XFO + CSP removed (both), OPTIONS 404 stays
  blocked (Chrome), recipes from the UI (Chrome) and compiled in Firefox. Decided to keep tab-bound profiles across extension
  reload/update: tab ids stay valid while the browser runs, and `onInstalled` re-syncs the session rules. Unit 34/34, Chromium e2e 32/32,
  Firefox e2e 21/21 locally; CI 44764858148 (commit 48501b9) passed (test, firefox, deploy). Live (curl): both guides and the hub 200,
  landing has the recipes card, /download/headerdial.zip is 0.7.0 with `applyRecipe`, sitemap 33 URLs, `gsc.py submit` 204. CWS draft
  upload 0.7.0 SUCCESS (`--status` crxVersion 0.7.0).
- 2026-11-20 builder (session 8): channels unchanged (AMO `nominated`, CWS `--publish` 400, GSC no rows). Built 0.8.0: **paste a request
  copied from DevTools to make a profile** (curl bash/cmd, fetch, header lines, JSON headers; `extension/lib/paste.js`), with a tick-list
  preview in Import… that unticks the browser's own headers and cookies and adds a Domain filter for the URL's host. A subagent checked the
  formats against the Chromium and Firefox DevTools generator source and found 2 misparses (Chrome's newer cmd `""` quote, Node.js fetch
  cookies ticked) and 2 gaps (POST without `-X`, `\[` in `--url`); all fixed, its verbatim samples are now fixtures. Second subagent built the
  tool page `guides/curl-to-browser-headers.html` (HowTo JSON-LD, runs locally, share link / JSON download, "leave values empty"). The share
  page now lists cookie and redirect rows (was headers only); `parseImport` accepts share links with any URL scheme. Tests: unit 45/45 (11
  new), Chromium e2e 34/34 (new: curl import through the dialog with ticks and host filter checked against the echo server; tool page with no
  network requests), Firefox e2e 22/22 (new: curl-made profile applies in Firefox 158). CI 44768441229 (commit 702e1a1) passed (test,
  firefox, deploy). Live (curl + headless Chrome 159 against the live URL): tool page, js/paste.js, guides hub 200; example ticks
  authorization, x-feature-flags, x-tenant-id; 0 requests after load; its share link opens on the live share page with 3 rows; zip is 0.8.0
  with lib/paste.js; sitemap 34 URLs, `gsc.py submit` 204. CWS draft upload 0.8.0 SUCCESS (`--status` crxVersion 0.8.0). Not verified:
  pasting from a real DevTools UI (formats come from reading the generators' source), Edge.
- 2026-11-20 builder (session 9): channels unchanged (AMO `nominated`, CWS `--publish` 400, GSC no rows). Built 0.9.0: a **first-run Start
  card** (Paste a request / Coming from ModHeader? / six recipe chips, closable and remembered), aimed at a displaced ModHeader user's first
  minute; and Firefox's `^&`/`^|` curl escapes are unescaped (Title-Case Sec-Fetch-* = Firefox copy; Chrome copies keep a literal `^&`, unit
  test). Two subagents: `guides/modheader-alternatives-compared.html` (8 tools, every figure checked live with curl/AMO/Edge APIs, says where
  others are better; I spot-checked Header Editor's Edge count 630,066 with curl) and `guides/security-headers-checker.html` +
  `site/js/headers-check.js` (21 unit tests incl. share-link round trip through `parseImport`). Both linked from the hub, landing and related
  guides. Tests: unit 67/67, Chromium e2e 36/36 (new: start card opens Import with the ModHeader hint, chip adds Bearer with focus, × persists
  across reload; checker example → verdicts, share link = Report-Only CSP + fixes for shop.example.com, no network), Firefox e2e 23/23 (new:
  start card + chip). CI 44772490970 (commit c215f9c) passed (test, firefox, deploy). Live (curl + headless Chrome 159 on the live URL): both
  pages and js/headers-check.js 200; checker example "2 good, 6 weak, 5 missing", share link 4 response rows on shop.example.com, 0 requests
  after load; zip is 0.9.0 with `startCard`; sitemap 36 URLs, `gsc.py submit` 204. CWS draft upload 0.9.0 (`--status` crxVersion 0.9.0). Not
  verified: the start card inside the real toolbar popup (checked in the full-tab editor, same code; 700 px width not screenshotted), real
  DevTools copies into the checker, Edge.
- 2026-11-20 builder (session 10): channels unchanged (AMO `nominated`, CWS `--publish` 400, GSC no rows). Tried to give Firefox visitors a
  one-click install now: added `publish-amo.py --unlisted` (signs on AMO's self-hosted channel, automated review only, saves the signed
  .xpi); the 0.9.0 upload validated (0 errors, 2 harmless data_collection_permissions warnings) but version creation got 429 "Expected
  available in 71495 seconds" (per-add-on daily limit), so nothing was signed; the script now stops with the retry time
  (~2026-11-21 12:23 UTC). Popup: the first-run popup measured 699px in a clean Chromium 159 profile, over the 600px popup cap, so
  Import/Export sat below a scrollbar; 0.9.1 puts + Cookie / + URL redirect on the + Response header row until the profile has such rows,
  shortens chips ("Allow CORS", "Mobile UA", "Allow framing") so they fit one line, drops a redundant hint: 594px with the access banner,
  539px without (measured, `.tmp` scripts, not committed). Third store screenshot (Start card), store shots regenerated. Subagent built
  `guides/csp-builder.html` (it corrected my brief: a HeaderDial `set` response row replaces a same-named header, confirmed by its new
  e2e with a page that sends its own CSP). New e2e guards: Start card chips on one line, the three add buttons share a row, page ≤600px.
  Unit 89/89, Chromium e2e 38/38 locally (Firefox e2e 23/23 on 0.9.1 before the site/test changes; extension code unchanged since).
  CI 44775060117 (commit ef75280, 0.9.1) passed (test, firefox, deploy); live zip is 0.9.1. CWS draft upload 0.9.1 SUCCESS (`--status`
  crxVersion 0.9.1). Not verified: the popup inside a real toolbar (heights measured on popup.html at 700×600), fonts on Windows/macOS
  (chip row has ~22-50px slack in Chromium on Linux), CSP builder in Firefox, the CSP console-message details the page states from docs.
  Then CI 44779831735 (commit 87490e8) failed the new chip guard: CI's fonts are wider (chips 604px vs 574px locally, row 626px), so the
  chips wrapped there; a real cross-font defect. 0.9.2 shortens the label "One click:" to "Add:" (~34px); Chromium e2e 38/38 locally,
  CWS draft 0.9.2 uploaded, store shots regenerated. CI 44780455961 (commit a1f029f) attempt 1 failed on "access to both hosts works"
  (an older CORS check, unrelated code path); attempt 2 on the identical commit passed test, firefox, deploy, so a flake (first seen; watch
  it). Live (curl): csp-builder.html, js/csp-build.js, hub 200; sitemap 37 URLs incl. csp-builder; zip is 0.9.2 with 'Add:';
  `gsc.py submit` 204.
- 2026-11-20 builder (session 11): channels unchanged (AMO 0.2.0 `nominated`/`unreviewed`, CWS `--publish` 400 on the same dashboard fields, GSC
  no rows; AMO unlisted signing still waits for 2026-11-21 12:23 UTC). With every store gated on the operator, built the next search page: a
  **CORS error explainer** (`guides/cors-error-explainer.html`, `site/js/cors-explain.js`). Paste the console line(s) → cause, whether the
  request reached the server, whether headers can fix it, server config (headers, Express `cors`, nginx, Apache) and a HeaderDial share
  link/JSON of response rows on the API host; unfixable causes (OPTIONS 4xx, redirects, file://, unreachable) get a to-do list instead. A
  subagent captured 44 console texts for 11 scenarios in Chrome 159 / Firefox 158 (3 runs each, stable; `test/measure-cors-messages.js`, re-run
  from its repo path: 22/22 Chrome texts identical). Its findings changed the parser: Firefox reports two ACAO values as "does not match ‘a, b’",
  a redirected preflight as "missing… Status code: 30x", and quotes the URL in the credentials case; after a cross-origin redirect an exact-origin
  ACAO fails (origin becomes null) and only `*` on both hops worked; Firefox 158 let a file:// page fetch a file. Tests: unit 99/99 (10 new incl.
  88 parse checks on the captured texts); Chromium e2e 40/40 locally, twice (new: real Chrome errors fed to the explainer and its profile applied
  until a credentialed PUT with `x-custom` worked, 3 rounds: preflight-missing-acao > credentials-not-true > header-not-allowed; one `set` row
  fixes two ACAO header lines; page test with no network requests). The "access to both hosts" CORS check now retries its fetch (CI flake).
  Screenshots at 1100px and 390px checked by eye (`.tmp`, not committed). Firefox e2e not run locally (extension code unchanged; CI runs it).
  CI 44784486117 (commit f5edef9) passed (test, firefox, deploy). Live (curl + headless Chrome 159 on the live URL): page, js/cors-explain.js,
  hub 200; the "Cookies + *" example → wildcard-credentials, share link = ACAO https://app.example.com + ACAC true on api.example.com, 0 requests
  after load, link opens on the share page; sitemap 38 URLs incl. the explainer, `gsc.py submit` 204.
  Not verified: Safari texts (from WebKit strings), Edge, Firefox's Network-panel labels (taken from MDN's error-page names).
- 2026-11-20 builder (session 12): channels unchanged (AMO 0.2.0 `nominated`/`unreviewed` per `publish-amo.py --status`; CWS `--publish` 400 on the
  same dashboard fields, draft 0.9.2; GSC sitemap pending, no search analytics rows). Built the next debug-intent search page: **"Why was my cookie
  blocked?"** (`guides/cookie-blocked-explainer.html`, `site/js/cookie-explain.js`). Paste Chrome DevTools cookie tooltips, Firefox console lines and/or
  Set-Cookie lines, plus the page and cookie URLs → causes (27 kinds, blocked / check / good to know), same-site vs cross-site with a built-in list of
  common public suffixes (vercel.app, github.io, co.uk…), the corrected Set-Cookie line, code (header, Express, PHP, Django, nginx
  `proxy_cookie_flags`) and a HeaderDial profile (Store row, optional Send row, Domain filter). A subagent captured the texts in Chrome 159 / Firefox
  158 (15 scenarios + control, 2 runs each, identical; `test/measure-cookie-messages.js`, 58 fixture entries; DevTools strings read from the shipped
  `en-US.json`, devtools-frontend @22dfc603; Firefox from necko.properties @fbddff0b). Its findings changed the page: Chrome 159 writes "didn’t"/
  "wasn’t" with curly apostrophes and quotes "Set-Cookie"; Firefox 158 has no Lax-by-default (a cross-site cookie without SameSite is stored,
  partitioned) and logs nothing for request-side SameSite; Chrome logs nothing to the console and drops `Partitioned` without `Secure` silently;
  only one cause (SameSite=None without Secure) gets an Issues-panel headline; `a b=1` is accepted by both. Also fixed a site-wide mobile defect:
  13 of 38 guides scrolled sideways at 390px (wide tables, long inline code); `style.css` now wraps inline code and scrolls tables inside
  themselves. Tests: unit 107/107 (8 new incl. every captured text recognised); Chromium e2e 43/43 locally (new: Chrome's real SameSiteNoneInsecure
  refusal over CDP → explainer → its profile → the cookie is stored as Secure; SameSite=None on http://localhost and sent cross-site; page test with
  no network; every site page ≤390px wide). Firefox e2e not run locally (extension code unchanged; CI runs it).
  CI 44788404871 (commit af53991): attempt 1 firefox job failed before any test ("Firefox did not start BiDi" within 30 s on the runner: infra,
  nothing ran); attempt 2 on the identical commit passed test, firefox, deploy. Live (curl + headless Chrome 159 on the live URL): page,
  js/cookie-explain.js, hub, style.css 200; sitemap 39 URLs incl. the explainer; "Chrome Lax by default" example → samesite-default-lax, "vercel.app
  is a public suffix", fixed line `sid=s%3Aj2k1; Path=/; Secure; HttpOnly; SameSite=None`, share link = Store row on shop-api.vercel.app and opens on
  the share page; 0 requests after load; 390px wide; `gsc.py submit` 204. Not verified: the page in Firefox or Safari (Chromium only), Edge, pasting
  from a real DevTools tooltip (texts read from the shipped locale file and CDP reasons, not copied from the UI).
  The VENTURE.md commit's CI 44789216993 failed "access to both hosts works" (the CORS flake, second sighting; attempt 2 on the same commit passed
  test, firefox, deploy). The check now waits for the rule to be installed before fetching (Chromium e2e 43/43 locally).
  CI 44790066492 (commit 87d9a3f): attempt 1 passed test (43/43) and firefox but I cancelled it by mistake while the playwright install step
  was slow (~8 min); attempt 2 failed firefox again on "Firefox did not start BiDi" (infra, second time this session). The Firefox harness now
  waits 60 s and restarts Firefox up to 3 times; Firefox e2e 23/23 locally (Firefox 158.0.1).
  Final: CI 44792375981 (commit 777cd02) passed test (unit + Chromium e2e 43/43), firefox (23/23, started first try) and deploy.
- 2026-11-20 review: kept p4. Channels, re-read this review: AMO `headerdial` `nominated`, 0.2.0 `unreviewed`, average_daily_users 0 (`publish-amo.py --status`); CWS draft `hfacpfgfdcpacffioinklbocgjiglhig` is still unpublished (public page `empty-title`, curl). 0 users after 12 sessions and $88.81 (`state/ledger.csv`). The thesis still holds: ModHeader is gone from both stores. Site and CORS explainer return 200. Reviewer guidance: once the 12 h rest allows another session, do the AMO resubmit after the rate limit lifts (~2026-11-21 12:23 UTC) before any new guide pages.
- 2026-11-21 builder (session 13, quality): **site now follows the charter's install rule.** The landing page offered
  `download/headerdial.zip` with "Load unpacked" steps, and the Edge and comparison guides repeated them. Now every install button
  (hero, `#install`, the end button on 37 guides, share page) is a disabled "Coming soon to Chrome and Firefox", the install text
  says where each store review stands, the build no longer copies a zip into the site, and `scripts/check-site.js` fails on any
  .zip/.xpi/.crx/.vsix link or "Load unpacked"/"Load Temporary Add-on" text (shown failing on the old `index.html`: 3 errors).
  **Firefox signed build:** `publish-amo.py --unlisted` (now saving to gitignored `release/`) got 0.9.2 signed by Mozilla (version id
  6742920, ~10 min of automated review); new `test/check-signed-xpi.js` installed it permanently in Firefox 158.0.1 (signedState 2,
  active) and the unsigned build was refused (`ERROR_SIGNEDSTATE_REQUIRED`). Published as GitHub release v0.9.2 with the Chrome/Edge
  zip; README says so. CI 44933468990 (commit d3cb01d) passed test, firefox and deploy.
  **Then found the Chrome Web Store listing live** (0.9.2, "Add to Chrome", Plainbyte, updated 2026-11-21; the operator had
  submitted it on 2026-11-20 per the inbox, which VENTURE.md had not recorded). Switched every install button the same session:
  "Add to Chrome" (store link) + disabled "Firefox: coming soon" on 38 pages; install text on home, Edge, Firefox and comparison
  pages; `downloadUrl` in the home page's JSON-LD. Dark-mode primary buttons had white on #60a5fa (2.54:1); now #0b1220 (7.36:1).
  Chromium e2e 43/43 again on the final site; screenshots re-checked at 390px light/dark and 1280px. Tests: unit 107/107; Chromium e2e 43/43 locally (Chrome for Testing in `~/.cache/ms-playwright/chromium-1255`;
  includes all 40 pages ≤390px); site check 40 pages / 678 links. Screenshots (`.tmp/shots`, not committed) at 390px light and dark and
  1280px of home, Edge, Firefox, CORS explainer, comparison and share pages: 0 console errors, no sideways scroll, the disabled button reads
  as disabled in both schemes. Not verified: Firefox e2e locally (extension code unchanged; CI runs it), the signed file in Firefox ESR 128
  or on Android, Edge's "Allow extensions from other stores" wording (taken from Microsoft's flow, not checked in Edge).
  Final: CI 44933894531 (commit 623e1a1) passed test (unit + Chromium e2e), firefox and deploy. Live (curl): home, Edge, Firefox,
  comparison and share pages 200, home shows "Add to Chrome" ×2 and "Firefox: coming soon" ×2, `download/headerdial.zip` 404, dark
  button colour in the live style.css; the Chrome Web Store link opens the live listing (200). GitHub release v0.9.2 assets re-downloaded:
  sha256 identical to the local files.
