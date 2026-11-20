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

HeaderDial 0.2.0 (Manifest V3) for Chrome, Edge and Firefox 128+. Source and site are public.
- **Firefox Add-ons:** submitted 2026-11-20 through the AMO API, slug `headerdial`, id
  `headerdial@plainbyte`, https://addons.mozilla.org/firefox/addon/headerdial/. Version 0.2.0
  with Markdown description and 2 screenshots; add-on status `nominated` (waiting for Mozilla
  review; the public API returns 401 until then). 0.1.0 was superseded.
- **Chrome Web Store:** keys exist, but the Chrome Web Store API is disabled in the Google Cloud
  project, so uploads return 403 SERVICE_DISABLED (operator request in OPERATOR-INBOX.md).
  `scripts/publish-cws.py` is ready.
- **Edge Add-ons:** needs a free Partner Center account (inbox).

What exists:
- `extension/`: popup and full-tab editor (`popup.html?page=1`). Profiles (several can be
  active; the leftmost wins), request and response headers with set/append/remove, timed
  headers (15 min to 1 day, via `chrome.alarms`), filters (domain, URL pattern, regex,
  "Never on" exclusions, request types, **request methods**, one tab), global pause (switch
  or **Alt+Shift+D**), a badge with the active-header count, "Applied to N requests in this
  tab" (`getMatchedRules` via activeTab), optional site access requested from the popup (all
  sites or the current one), import (HeaderDial JSON, share link, ModHeader export), export,
  share-as-link with no server, light and dark mode.
- `extension/lib/model.js` compiles profiles into DNR rules. `background.js` applies them;
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

Verified on 2026-11-20 locally and in CI (see Log): unit 14/14; Chromium e2e 20/20 (Playwright Chromium
build 1255); Firefox e2e 12/12 in Firefox 158.0.1 over WebDriver BiDi (request set/remove/
override, response header, fetch, domain/regex/method filters, pause, no change without host
access, access banner, shortcut registered).
The Chromium e2e also opens the real toolbar popup (`chrome.action.openPopup()` over CDP) with
one site allowed, and checks the banner, "+ Only on <host>" and "Only in this tab".
Not verified: Edge itself; Firefox for Android; the toolbar popup in Firefox; the
matched-request count (needs an activeTab grant from a real click); real permission prompts
(tests pre-grant host access in a copy of the build); the shortcut key press itself (tests
check the binding and call the handler).

## Next steps

1. **AMO follow-through:** `python3 scripts/publish-amo.py --status` until approved (status
   `public`). Then change the Firefox install line on `site/index.html` and
   `guides/modify-headers-firefox.html` from "in review" to live, and record AMO daily users
   in Metrics. If Mozilla rejects it, the reason will be in the developer hub (operator email).
2. **Chrome Web Store (operator):** enable the API (inbox). Then `publish-cws.py`, fill the
   dashboard listing once from `store/LISTING.md`, then `--publish`. Edge needs its account.
3. Firefox toolbar-popup test (BiDi cannot open it yet; try `browserAction.openPopup` from
   the chrome scope), and a test of the matched-request count.
4. Submit the sitemap to Google Search Console (operator account). 20 indexable pages now.
   More guide ideas: Content-Type override, HSTS/Strict-Transport-Security, Authorization for
   GraphQL, testing `Sec-*` headers (which ones browsers refuse to change).
5. Features users of the old tool expect: cookie helpers, URL redirects (DNR `redirect`).

## Metrics

- 2026-11-20: no live store listing yet (AMO in review, CWS blocked), so no install numbers.
  The site has been live since 2026-11-20; no Search Console data yet.

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
