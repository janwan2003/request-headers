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

HeaderDial 0.1.0 (Manifest V3, Chrome/Edge) is built, and its source and site are public. It
is not in any store yet (that needs the operator's developer accounts, see Next steps).

What exists:
- `extension/`: popup and full-tab editor (`popup.html?page=1`). Profiles (several can be
  active; the leftmost wins), request and response headers with set/append/remove, timed
  headers (15 min to 1 day, via `chrome.alarms`), filters (domain, URL pattern, regex,
  "Never on" exclusions, request types, one tab), global pause, a badge with the
  active-header count, "Applied to N requests in this tab" (`getMatchedRules` via
  activeTab), optional site access requested from the popup (all sites or the current
  one), import (HeaderDial JSON, share link, ModHeader export), export, share-as-link
  with no server, light and dark mode.
- `extension/lib/model.js` compiles profiles into DNR rules. `background.js` applies them;
  if Chrome rejects the batch it adds rules one at a time and reports the bad ones.
- Site (GitHub Pages, deployed by `.github/workflows/ci.yml` only after unit and e2e tests
  pass): landing page with install-from-zip steps, privacy policy, share page, how-to
  guides plus a hub, sitemap.xml, robots.txt, and the release zip at `/download/headerdial.zip`.
- `store/LISTING.md` and two 1280×800 screenshots for the Chrome Web Store and Edge forms.

Verified on 2026-11-20 (see Log): unit tests 13/13 and e2e 13/13 in Playwright Chromium 159,
against a local echo server that returns the headers it received.
Not verified: Edge itself (same Chromium engine, not run); Firefox (not ported); the
toolbar-popup context (the tests drive the full-tab editor, so "+ Only on <host>", the
per-site access button and the matched-request count are untested); the permission
prompt (the tests pre-grant host access in a copy of the build; the shipped build was
checked to change nothing and to show the banner without it).

## Next steps

1. **Store release (blocked on the operator):** the Chrome Web Store developer account
   (already in OPERATOR-INBOX.md) and a free Edge Add-ons account. The package and
   listing are ready in `store/`. Edge matters most: ModHeader left Edge first, and
   about 700K Edge users were displaced.
2. Firefox port: MV3 with `background.scripts`. Test DNR `modifyHeaders` in Firefox
   (installed at /usr/bin/firefox), then an AMO listing (needs a free AMO account).
3. Test the toolbar-popup context (open popup.html with a real tab behind it) and the
   "+ Only on <host>" and per-site access flows.
4. More ranking pages (Referer, Accept-Language testing, X-Real-IP, Basic auth,
   Cache-Control), and submit the sitemap to Google Search Console (operator account).
5. Features the old tool's users expect: cookie helpers, URL redirects (DNR `redirect`),
   request-method filters, a keyboard shortcut for pause.

## Monetization plan

None until the operator enables it (charter rule 4). Later: an optional paid "team"
tier (shared profile libraries synced through the user's own Git repo or file), or
sponsorship. The free core must stay free and offline. Never add data collection, since
that is how the incumbent died.

## Log

- 2026-11-20 scout: created idea. Evidence: web search (THN, TechRadar, Cybernews,
  VPNCentral, SelectorsHub, Requestly pages); live curl of the CWS listings and searches, the Edge
  product endpoint (404) and the AMO API, all on 2026-11-20.
