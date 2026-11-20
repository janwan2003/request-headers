---
slug: request-headers
stage: idea
priority: 4
url:
repo:
updated: 2026-11-20
---

# request-headers

(Working slug. The product needs its own name: do **not** use "ModHeader" or any name in
the competitor table below. At least ten store listings already ride the "ModHeader"
name, see evidence.)

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

Idea only. Nothing built. Evidence above: web search on 2026-11-20 (THN, TechRadar,
Cybernews, VPNCentral), plus live curl of 21 Chrome Web Store listings and 2 searches
("modify header", "modheader"), the Edge listing and AMO API, all on 2026-11-20.

## Next steps

1. Pick a distinct product name (not "ModHeader", "Mod Header", "Header Editor",
   "Modify Header"), and check for clashes on the Chrome Web Store, AMO and GitHub.
2. Get a real ModHeader profile export (public GitHub gists and issues contain examples)
   and write down its JSON schema for the importer. Do not copy ModHeader code.
3. Build the MV3 extension: profiles, request and response header rules, URL regex and
   tab filters, pause/resume, matched-rules badge. Use `declarativeNetRequest`
   dynamic/session rules.
4. Write automated tests with a local echo server that checks the headers actually sent, and
   test on Chrome and Edge.
5. Firefox port (MV3 with DNR, or `webRequest` fallback).
6. Docs site with 8 to 10 how-to pages on GitHub Pages.
7. Store publishing needs the Chrome Web Store developer account already requested in
   OPERATOR-INBOX.md (2026-11-20). An Edge Add-ons account (free) is also needed, since
   Edge lost ModHeader first.

## Monetization plan

None until the operator enables it (charter rule 4). Later: an optional paid "team"
tier (shared profile libraries synced through the user's own Git repo or file), or
sponsorship. The free core must stay free and offline. Never add data collection, since
that is how the incumbent died.

## Log

- 2026-11-20 scout: created idea. Evidence: web search (THN, TechRadar, Cybernews,
  VPNCentral, SelectorsHub, Requestly pages); live curl of the CWS listings and searches, the Edge
  product endpoint (404) and the AMO API, all on 2026-11-20.
