#!/usr/bin/env python3
"""Write one GitHub Actions repository secret from a local file, without displaying it.

  GH_TOKEN=<fine-grained token: this repository, Secrets read+write> python3 gh_secret.py OWNER/REPO NAME FILE

Seals the file with the repository's public key (libsodium sealed box, as GitHub requires; python3-nacl)
and PUTs it. Prints ONLY the HTTP status. Never prints, logs or stores the token or the file contents.
"""
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
test_base = os.environ.get("SK_GH_API_BASE", "")
if test_base:
    if not test_base.startswith("http://127.0.0.1"):
        sys.exit("BLOCK SK_GH_API_BASE is only honoured for a loopback test server")
    API = test_base


def call(method, path, token, body=None):
    request = urllib.request.Request(
        API + path,
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "schoolkit-ops-tools",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as error:
        return error.code, {}


def main():
    if len(sys.argv) != 4:
        sys.exit("usage: GH_TOKEN=... gh_secret.py OWNER/REPO NAME FILE")
    repo, name, path = sys.argv[1:]
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        sys.exit("BLOCK no token supplied")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) or not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
        sys.exit("BLOCK repository or secret name is malformed")
    try:
        from nacl import encoding, public
    except ImportError:
        sys.exit("BLOCK python3-nacl is not installed (sudo apt-get install -y python3-nacl)")
    with open(path, "rb") as handle:
        value = handle.read()
    if not value.strip():
        sys.exit("BLOCK the file is empty; nothing was written")
    status, key = call("GET", f"/repos/{repo}/actions/secrets/public-key", token)
    if status != 200 or "key" not in key or "key_id" not in key:
        sys.exit(f"BLOCK could not read the repository public key (HTTP {status}); check the token's repository and Secrets permission")
    sealed = public.SealedBox(public.PublicKey(key["key"].encode(), encoding.Base64Encoder())).encrypt(value)
    status, _ = call("PUT", f"/repos/{repo}/actions/secrets/{name}", token, {"encrypted_value": base64.b64encode(sealed).decode(), "key_id": key["key_id"]})
    if status not in (201, 204):
        sys.exit(f"BLOCK GitHub refused the write (HTTP {status})")
    print(f"PASS secret {name} written (HTTP {status}); contents were never displayed")


if __name__ == "__main__":
    main()
