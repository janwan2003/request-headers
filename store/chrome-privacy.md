# Chrome Web Store: first publish of HeaderDial (operator steps)

The package is already uploaded through the API: item id **`hfacpfgfdcpacffioinklbocgjiglhig`**
(version 0.9.1, uploaded on 2026-11-20; 0.2.0 to 0.9.0 were uploaded first). Open
https://chrome.google.com/webstore/devconsole, click the item, and fill the fields below. Every
value is copy-paste ready. When done, tell a builder (or run
`python3 scripts/publish-cws.py --publish` in `ventures/request-headers`) to submit it for review.

The API's own list of what is missing (from `publish-cws.py --publish`, 2026-11-20): privacy
practices, policy certification, language, category, icon, a screenshot, detailed description,
and a **verified publisher contact email** (Settings page, once per account; it covers every
studio extension).

## Account → Settings (once for all studio extensions)
- Publisher name: `Plainbyte`
- Contact email: an address you read, then click the verification link Google sends.

## Store listing tab
- Description: the "Description" section of `store/LISTING.md` (paste as is).
- Category: **Developer Tools**
- Language: **English (United States)**
- Store icon (128×128): `extension/icons/128.png`
- Screenshots (1280×800): `store/screenshot-1-editor.png`, `store/screenshot-2-private.png`, `store/screenshot-3-start.png`
- Small promo tile (440×280): `store/promo-small-440x280.png`
- Marquee promo tile (1400×560, optional): `store/promo-marquee-1400x560.png`
- Official URL: none. Homepage URL: `https://janwan2003.github.io/request-headers/`
- Support URL: `https://github.com/janwan2003/request-headers/issues`
- Mature content: No

## Privacy practices tab
**Single purpose description**
> Modify the browser's HTTP requests and responses according to rules the user writes: add, change or remove headers, and redirect URLs.

**Permission justifications** (one box each)
- declarativeNetRequest:
  > Applies the user's rules (add, change or remove request and response headers; redirect a URL the user names) through the browser's declarativeNetRequest engine. The extension never reads request or response content.
- storage:
  > Saves the user's header profiles and settings locally in the browser.
- alarms:
  > Switches timed headers off when the time the user chose (15 minutes to 1 day) runs out.
- activeTab:
  > When the user opens the popup, reads the current tab's address to offer "Only on this site" and to show how many requests in that tab the rules changed.
- Host permission (optional `<all_urls>`):
  > Chrome only applies header changes on sites the extension may access. Access is optional and requested from the popup only when the user asks: for all sites, or for the current site only. It can be revoked in Chrome's extension settings.

**Are you using remote code?**
> No, I am not using remote code.

**Data usage**: tick **none** of the data types. Profiles (which may contain tokens the user
typed) stay in local extension storage and are never transmitted, so nothing is "collected" in
the store's sense.

Tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**
> https://janwan2003.github.io/request-headers/privacy.html

## Distribution tab
- Visibility: **Public**. Regions: **All regions**. Free of charge.

## Test instructions tab (if asked)
> No account or login needed. Open the popup, click "Allow on all sites", click "+ Request header", enter X-Test / hello, then load https://httpbin.org/headers in a new tab: the response lists "X-Test": "hello".
