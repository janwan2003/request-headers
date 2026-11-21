#!/usr/bin/env python3
"""Submit dist/headerdial-firefox-<version>.zip to addons.mozilla.org (listed channel).

  python3 scripts/publish-amo.py            # first run creates the listing, later runs add a version
  python3 scripts/publish-amo.py --status   # print the listing's review state
  python3 scripts/publish-amo.py --listing  # push store/amo-listing.json text and the screenshots
  python3 scripts/publish-amo.py --unlisted # sign the current version on the unlisted (self-hosted) channel and
                                            # save the Mozilla-signed file as release/headerdial-firefox-<version>.xpi (for GitHub releases)

Credentials: AMO_JWT_ISSUER / AMO_JWT_SECRET from the studio .env; nothing secret is printed.
"""
import base64, hashlib, hmac, json, re, sys, time, urllib.error, urllib.request, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
env = dict(l.split("=", 1) for l in (ROOT.parent.parent / ".env").read_text().splitlines() if "=" in l)
API = "https://addons.mozilla.org/api/v5"
ADDON_ID = "headerdial@plainbyte"
LISTING = json.loads((ROOT / "store" / "amo-listing.json").read_text())


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def auth():
    now = int(time.time())
    head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps({"iss": env["AMO_JWT_ISSUER"], "jti": str(uuid.uuid4()), "iat": now, "exp": now + 60}).encode())
    sig = b64(hmac.new(env["AMO_JWT_SECRET"].encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"JWT {head}.{body}.{sig}"


def call(method, path, body=None, ctype="application/json"):
    req = urllib.request.Request(API + path, data=body, method=method, headers={"Authorization": auth()})
    if body is not None:
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


def listing():
    keep = {k: LISTING[k] for k in ("name", "summary", "description", "categories", "homepage", "support_url")}
    st, res = call("PATCH", f"/addons/addon/{ADDON_ID}/", json.dumps(keep).encode())
    print("listing", st, res if st != 200 else "updated")
    st, cur = call("GET", f"/addons/addon/{ADDON_ID}/")
    have = len(cur.get("previews") or [])
    shots = ["screenshot-1-editor.png", "screenshot-2-private.png", "screenshot-3-start.png"]
    for i, name in enumerate(shots[have:], start=have):
        body, ctype = multipart({"position": str(i)}, "image", name, (ROOT / "store" / name).read_bytes(), "image/png")
        st, res = call("POST", f"/addons/addon/{ADDON_ID}/previews/", body, ctype)
        print("preview", name, st, res.get("id", res))


def multipart(fields, file_field, filename, data, mime="application/zip"):
    boundary = uuid.uuid4().hex
    out = b""
    for k, v in fields.items():
        out += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    out += (f'--{boundary}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
            f"Content-Type: {mime}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    return out, f"multipart/form-data; boundary={boundary}"


def main():
    if "--status" in sys.argv:
        st, res = call("GET", f"/addons/addon/{ADDON_ID}/")
        keep = ("slug", "status", "url", "is_disabled", "average_daily_users", "current_version", "ratings")
        print(st, json.dumps({k: res.get(k) for k in keep} if st == 200 else res, indent=2)[:3000])
        return
    if "--listing" in sys.argv:
        listing()
        return
    if "--fetch" in sys.argv:
        fetch_signed(int(sys.argv[sys.argv.index("--fetch") + 1]),
                     json.loads((ROOT / "extension" / "manifest.json").read_text())["version"])
        return
    version = json.loads((ROOT / "extension" / "manifest.json").read_text())["version"]
    zpath = ROOT / "dist" / f"headerdial-firefox-{version}.zip"
    channel = "unlisted" if "--unlisted" in sys.argv else "listed"
    body, ctype = multipart({"channel": channel}, "upload", zpath.name, zpath.read_bytes())
    st, up = call("POST", "/addons/upload/", body, ctype)
    print("upload", st, up.get("uuid"), up.get("processed"))
    if st >= 300:
        print(json.dumps(up, indent=2)); sys.exit(1)
    for _ in range(60):
        if up.get("processed"):
            break
        time.sleep(3)
        st, up = call("GET", f"/addons/upload/{up['uuid']}/")
    v = up.get("validation") or {}
    print("valid", up.get("valid"), "errors", v.get("errors"), "warnings", v.get("warnings"), "notices", v.get("notices"))
    for m in v.get("messages", []):
        print(" -", m.get("type"), m.get("id"), "|", m.get("message"), "|", m.get("file"), "|", str(m.get("description"))[:300])
    if not up.get("valid"):
        sys.exit(1)
    for attempt in range(5):  # AMO throttles bursts; it says how long to wait
        st, existing = call("GET", f"/addons/addon/{ADDON_ID}/")
        if st == 200:
            st, res = call("POST", f"/addons/addon/{ADDON_ID}/versions/",
                           json.dumps({"upload": up["uuid"], "license": "MIT"}).encode())
        else:
            payload = dict(LISTING, version={"upload": up["uuid"], "license": "MIT"})
            st, res = call("POST", "/addons/addon/", json.dumps(payload).encode())
        if st != 429:
            break
        # AMO limits new versions per add-on per day ("Expected available in 71495 seconds"):
        # wait out short throttles, stop on long ones (the validated upload is lost; rerun later).
        wait = int((re.findall(r"in (\d+) seconds", str(res.get("detail"))) or ["30"])[0])
        print("throttled:", res.get("detail"))
        if wait > 300:
            ready = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(time.time() + wait))
            sys.exit(f"AMO throttle: no new version before about {ready}; rerun this command then.")
        time.sleep(wait + 2)
    print("submit", st, json.dumps(res, indent=2)[:2500])
    if channel == "unlisted" and st < 300:
        fetch_signed(res["id"], version)


def fetch_signed(vid, version):
    """Unlisted versions get automated review only; wait for the signed file and save it for a GitHub release
    (the charter allows manual-install files only there, never on the product page)."""
    for _ in range(120):
        st, v = call("GET", f"/addons/addon/{ADDON_ID}/versions/{vid}/")
        f = (v.get("file") or {}) if st == 200 else {}
        print("file status", st, f.get("status"))
        if f.get("status") == "public" and f.get("url"):
            req = urllib.request.Request(f["url"], headers={"Authorization": auth()})
            data = urllib.request.urlopen(req).read()
            out = ROOT / "release" / f"headerdial-firefox-{version}.xpi"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            (out.parent / f"headerdial-firefox-{version}.json").write_text(json.dumps(
                {"version": version, "sha256": hashlib.sha256(data).hexdigest(), "amo_version_id": vid}, indent=2) + "\n")
            print("saved", out.relative_to(ROOT), len(data), "bytes, sha256", hashlib.sha256(data).hexdigest())
            return
        if f.get("status") in ("disabled",):
            sys.exit("signing refused: " + json.dumps(v)[:1500])
        time.sleep(10)
    sys.exit("not signed after 20 minutes; rerun later with --fetch " + str(vid))


main()
