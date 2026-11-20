# HeaderDial

Open-source browser extension (Chrome, Edge and Firefox 128+, Manifest V3) to add, change or remove
HTTP request and response headers. Website: https://janwan2003.github.io/request-headers/

- Profiles (several active at once, leftmost wins), each with request and response headers
- Operations: set, append, remove
- Recipes (`RECIPES` in `extension/lib/model.js`): CORS for the tab's origin, allow framing, Bearer token with a 1-hour timer, mobile User-Agent, no-cache, X-Forwarded-For
- Filters: domains, URL patterns, URL regexes, the page that made the request ("Page domain"), exclusions, request types, methods, a single tab
- Timed headers that switch themselves off (15 min to 1 day)
- URL redirects: replace text in the URL or use a regex with groups (DNR `redirect` rules)
- Cookie rows: send `name=value` after the browser's own cookies (one DNR `append` on `Cookie`), or store a cookie through an added `Set-Cookie` line
- Copy a profile as a `curl` command for the current tab's URL, and the reverse: paste a request copied from DevTools or Postman (curl in bash or Windows cmd form, `fetch(...)`, raw header lines, a JSON object of headers) to make a profile (`extension/lib/paste.js`); headers the browser sends itself come unticked
- Import ModHeader profile exports, or recover profiles from a disabled ModHeader's LevelDB data folder (`extension/lib/leveldb.js`, read locally); export and import JSON; share a profile as a link
  (the profile is encoded after `#`, nothing is uploaded)
- No account, no analytics, no network requests, no remote code

## How it works

`extension/lib/model.js` compiles profiles into
[`declarativeNetRequest`](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
rules; `extension/background.js` installs them (dynamic rules, or session rules for
tab-bound profiles). The browser applies the rules, so the extension never reads your
traffic. Changing headers needs site access, which the popup asks for (all sites or
one site).

There is no bundler: the files in `extension/` are exactly what ships.

## Develop

```sh
pnpm install            # only playwright-core, for the end-to-end test
pnpm test               # unit tests (node --test)
pnpm e2e                # builds, loads the extension into Chromium, checks real headers
pnpm e2e:firefox        # builds, installs it into Firefox over WebDriver BiDi, same kind of checks
node scripts/build.js   # dist/extension, dist/firefox, both zips, dist/site
```

Load `extension/` (or `dist/extension`) with "Load unpacked" on `chrome://extensions`.
In Firefox, load `dist/firefox/manifest.json` from `about:debugging` → This Firefox →
Load Temporary Add-on. The Firefox build is the same files with a different manifest
(event-page background scripts, an add-on id, `data_collection_permissions: none`).

## Release

```sh
node scripts/build.js
python3 scripts/publish-amo.py     # Firefox: new listing on first run, new version after
python3 scripts/publish-cws.py     # Chrome Web Store: upload; --publish to submit for review
```

Both read store credentials from the studio `.env` and print no secrets.

## Licence

MIT
