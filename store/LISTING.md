# HeaderDial – store listing (Chrome Web Store and Edge Add-ons)

Package: `node scripts/build.js` → `dist/headerdial-<version>.zip` (the zip root holds manifest.json).
Also downloadable from https://janwan2003.github.io/request-headers/download/headerdial.zip

## Name
HeaderDial – Modify HTTP Request & Response Headers

## Summary (≤132 chars)
Add, change or remove request and response headers, or redirect URLs. Profiles, filters, timed headers. Open source, no tracking.

## Category
Developer Tools

## Description
HeaderDial adds, changes or removes HTTP headers on the requests your browser sends and the responses it receives. It is built for web and API developers, QA testers and support engineers.

What you can do:
• Send an Authorization header or API key to a staging server
• Set X-Forwarded-For, User-Agent, Accept-Language or any custom header
• Remove headers such as Cookie or Referer
• Add CORS headers (Access-Control-Allow-Origin) while developing locally
• Remove or replace Content-Security-Policy and X-Frame-Options while debugging

Features:
• Profiles with colours. Run several at once; one switch (or Alt+Shift+D) pauses everything
• Set, append or remove, on requests and on responses
• URL redirects: send requests for one URL to another (e.g. a production script to localhost), including ModHeader URL replacements
• Filters: domains, URL patterns, regular expressions, the page that made the request, exclusions, request types, methods, or a single tab
• Timed headers that switch themselves off after 15 minutes, an hour or a day
• Cookies by name: send an extra cookie with matching requests, or store one in the browser as if the server set it
• Copy a profile as a curl command for the current page
• Import profiles exported from ModHeader (headers, cookies, URL replacements, filters); export and import JSON
• Recover profiles from a disabled ModHeader's data folder, read locally, when you have no export
• Share a profile as a link: the profile is inside the link, nothing is uploaded
• The badge shows how many headers and redirects are active; the popup shows how many requests in the tab were changed
• Light and dark mode

Private by design:
• No account, no analytics, no network requests, no remote code
• Open source (MIT): https://github.com/janwan2003/request-headers. No bundler, so the files in this package are the files in the repository
• Uses the browser's declarativeNetRequest API: HeaderDial gives the browser a list of rules and never reads your traffic
• Site access is optional and requested when you need it: all sites, or only the one you are on

## Single purpose (CWS form)
Modify the browser's HTTP requests and responses according to rules the user writes: add, change or remove headers, and redirect URLs.

## Permission justifications
- declarativeNetRequest: applies the user's header rules (modifyHeaders) and URL redirects (redirect) through the browser's rule engine.
- storage: saves the user's profiles locally.
- alarms: turns timed headers off when their time runs out.
- activeTab: when the user opens the popup, reads the current tab's address to offer "only on this site", and to show how many requests in that tab the rules changed.
- Optional host permissions (<all_urls>): browsers only apply header changes on sites the extension can access. Requested from the popup at the user's request, for all sites or for the current site only.
- Remote code: none.

## Data usage (CWS form)
Collects no user data. Does not sell or transfer data. Not used for creditworthiness or lending.

## URLs
- Homepage: https://janwan2003.github.io/request-headers/
- Privacy policy: https://janwan2003.github.io/request-headers/privacy.html
- Support: https://github.com/janwan2003/request-headers/issues

## Images
- Icon 128×128: extension/icons/128.png
- Screenshots 1280×800: store/screenshot-1-editor.png, store/screenshot-2-private.png
  (regenerate: `node scripts/build.js && node scripts/screenshots.js store`)

## Firefox Add-ons (AMO)

Submitted 2026-11-20 through the AMO API (`scripts/publish-amo.py`, metadata in
`store/amo-listing.json`). Slug `headerdial`, add-on id `headerdial@plainbyte`, listed
channel, category Web Development, licence MIT, Firefox 128+.
Listing: https://addons.mozilla.org/firefox/addon/headerdial/ (status `nominated` = waiting for review).

- Name on Firefox: "HeaderDial: Modify Request & Response Headers" (AMO allows at most 45 characters).
- Description: Markdown (AMO does not render HTML). Pushed with `publish-amo.py --listing` on
  2026-11-20 13:26 UTC, together with the two screenshots (preview ids 456217, 456218).
- AMO throttles writes: after a few creates/edits it returned 429 for about an hour.
- Version 0.2.0 submitted 2026-11-20 (0.1.0 was superseded, now `disabled`).
- Validator: 0 errors, 2 warnings (`data_collection_permissions` is ignored before Firefox 140 /
  Android 142; harmless because older versions do not need it).
