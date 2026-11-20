#!/usr/bin/env python3
"""Upload dist/headerdial-<version>.zip to the Chrome Web Store, and optionally publish.

  python3 scripts/publish-cws.py            # create the item (first run) or upload a new version
  python3 scripts/publish-cws.py --publish  # then submit it for review
  python3 scripts/publish-cws.py --status   # print the item's state

Credentials come from the studio .env (CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN,
CWS_PUBLISHER_ID); nothing secret is printed. The item id is kept in store/cws-item.json.
"""
import json, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT.parent.parent / ".env"
ITEM_FILE = ROOT / "store" / "cws-item.json"

env = dict(l.split("=", 1) for l in ENV_FILE.read_text().splitlines() if "=" in l)


def token():
    data = urllib.parse.urlencode(dict(client_id=env["CWS_CLIENT_ID"], client_secret=env["CWS_CLIENT_SECRET"],
                                       refresh_token=env["CWS_REFRESH_TOKEN"], grant_type="refresh_token")).encode()
    return json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token", data))["access_token"]


def call(method, url, tok, body=None, ctype=None):
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Authorization": f"Bearer {tok}", "x-goog-api-version": "2"})
    if ctype:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, {"raw": raw[:500].decode(errors="replace")}


def main():
    version = json.loads((ROOT / "extension" / "manifest.json").read_text())["version"]
    tok = token()
    item = json.loads(ITEM_FILE.read_text())["id"] if ITEM_FILE.exists() else None
    if "--status" in sys.argv:
        print(call("GET", f"https://www.googleapis.com/chromewebstore/v1.1/items/{item}?projection=DRAFT", tok))
        return
    if "--publish" in sys.argv:
        print(call("POST", f"https://www.googleapis.com/chromewebstore/v1.1/items/{item}/publish", tok,
                   b"", "application/json"))
        return
    zip_bytes = (ROOT / "dist" / f"headerdial-{version}.zip").read_bytes()
    if item:
        status, res = call("PUT", f"https://www.googleapis.com/upload/chromewebstore/v1.1/items/{item}", tok,
                           zip_bytes, "application/zip")
    else:
        status, res = call("POST", "https://www.googleapis.com/upload/chromewebstore/v1.1/items", tok,
                           zip_bytes, "application/zip")
        if res.get("id"):
            ITEM_FILE.write_text(json.dumps({"id": res["id"]}, indent=2) + "\n")
    print(status, json.dumps(res, indent=2))


main()
