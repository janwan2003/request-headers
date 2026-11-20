#!/usr/bin/env python3
"""Google Search Console for HeaderDial's GitHub Pages site, and nothing else.

  python3 scripts/gsc.py token    # print the META verification tag to put in site/index.html
  python3 scripts/gsc.py verify   # after the tag is live: verify, add the site, submit the sitemap
  python3 scripts/gsc.py status   # sitemap state + last 28 days of queries and pages
  python3 scripts/gsc.py submit   # resubmit the sitemap after adding pages

Reads CWS_CLIENT_ID / CWS_CLIENT_SECRET / GSC_REFRESH_TOKEN from the studio .env and never
prints them. The token also sees the operator's other sites: this script only ever names SITE.
"""
import datetime, json, sys, urllib.error, urllib.parse, urllib.request
from pathlib import Path

SITE = "https://janwan2003.github.io/request-headers/"
SITEMAP = SITE + "sitemap.xml"
ENV_FILE = Path(__file__).resolve().parent.parent.parent.parent / ".env"


def access_token():
    env = {}
    for line in ENV_FILE.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip("'\"")
    data = urllib.parse.urlencode(dict(client_id=env["CWS_CLIENT_ID"], client_secret=env["CWS_CLIENT_SECRET"],
                                       refresh_token=env["GSC_REFRESH_TOKEN"], grant_type="refresh_token")).encode()
    return json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token", data))["access_token"]


def call(tok, method, url, body=None):
    req = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:400].decode(errors="replace")


def main(cmd):
    tok = access_token()
    site = urllib.parse.quote(SITE, safe="")
    wm = f"https://www.googleapis.com/webmasters/v3/sites/{site}"
    if cmd == "token":
        s, r = call(tok, "POST", "https://www.googleapis.com/siteVerification/v1/token",
                    {"site": {"type": "SITE", "identifier": SITE}, "verificationMethod": "META"})
        print(s, r["token"] if s == 200 else r)
    elif cmd == "verify":
        s, r = call(tok, "POST", "https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=META",
                    {"site": {"type": "SITE", "identifier": SITE}})
        print("verify", s, "ok" if s == 200 else r)  # a 200 body lists owner emails: never print it
        print("add site", *call(tok, "PUT", wm))
        print("submit sitemap", *call(tok, "PUT", f"{wm}/sitemaps/" + urllib.parse.quote(SITEMAP, safe="")))
    elif cmd == "submit":  # resubmit the sitemap after adding pages
        print("submit sitemap", *call(tok, "PUT", f"{wm}/sitemaps/" + urllib.parse.quote(SITEMAP, safe="")))
    elif cmd == "status":
        s, r = call(tok, "GET", f"{wm}/sitemaps")
        print("sitemaps", s, json.dumps(r, indent=1))
        end = datetime.date.today()
        start = end - datetime.timedelta(days=28)
        for dim in ("query", "page"):
            s, r = call(tok, "POST", f"{wm}/searchAnalytics/query",
                        {"startDate": str(start), "endDate": str(end), "dimensions": [dim], "rowLimit": 25})
            print(dim, start, end, s, json.dumps(r, indent=1))
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
