# HeaderDial

Open-source browser extension (Chrome and Edge, Manifest V3) to add, change or remove
HTTP request and response headers. Website: https://janwan2003.github.io/request-headers/

- Profiles (several active at once, leftmost wins), each with request and response headers
- Operations: set, append, remove
- Filters: domains, URL patterns, URL regexes, exclusions, request types, a single tab
- Timed headers that switch themselves off (15 min to 1 day)
- Import ModHeader profile exports; export and import JSON; share a profile as a link
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
node scripts/build.js   # dist/extension, dist/headerdial-<version>.zip, dist/site
```

Load `extension/` (or `dist/extension`) with "Load unpacked" on `chrome://extensions`.

## Licence

MIT
