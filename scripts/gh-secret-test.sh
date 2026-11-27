#!/usr/bin/env bash
# Tests ops-tools/gh_secret.py against a LOOPBACK mock of the GitHub secrets API: the value is sealed with
# the mock's public key and the mock decrypts it, proving the bytes arrive intact; nothing leaks to output.
set -u
root=$(cd "$(dirname "$0")/.." && pwd); t=$(mktemp -d); trap 'kill ${srv:-0} 2>/dev/null; rm -rf "$t"' EXIT; fail=0
python3 -c 'import nacl' 2>/dev/null || { echo "SKIP python3-nacl not installed"; exit 0; }
cat > "$t/mock.py" <<'PY'
import base64, json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from nacl import encoding, public
sk = public.PrivateKey.generate()
out = sys.argv[1]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        if self.headers.get("Authorization") != "Bearer fixture-token": self.send_response(401); self.end_headers(); return
        body = json.dumps({"key_id": "k1", "key": sk.public_key.encode(encoding.Base64Encoder()).decode()}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
    def do_PUT(self):
        if self.headers.get("Authorization") != "Bearer fixture-token": self.send_response(401); self.end_headers(); return
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        plain = public.SealedBox(sk).decrypt(base64.b64decode(data["encrypted_value"]))
        open(out, "wb").write(plain); open(out + ".path", "w").write(self.path + " " + data["key_id"])
        self.send_response(204); self.end_headers()
srv = HTTPServer(("127.0.0.1", 0), H); print(srv.server_port, flush=True); srv.serve_forever()
PY
python3 "$t/mock.py" "$t/received" > "$t/port" & srv=$!
for _ in $(seq 1 50); do [ -s "$t/port" ] && break; sleep 0.1; done; port=$(cat "$t/port")
printf 'BACKUP_BUCKET=fixture\nHEALTHCHECK_PING_URL=https://hc-ping.com/SECRETVALUE\n' > "$t/file"
chk() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
out=$(SK_GH_API_BASE=http://127.0.0.1:$port GH_TOKEN=fixture-token python3 "$root/infra/vps/ops-tools/gh_secret.py" o/r BACKUP_ENV_FILE "$t/file" 2>&1); rc=$?
chk "secret written and the mock decrypts exactly the file's bytes" '[ $rc = 0 ] && cmp -s "$t/file" "$t/received"'
chk "request went to the right secret path with the key id" 'grep -q "/repos/o/r/actions/secrets/BACKUP_ENV_FILE k1" "$t/received.path"'
chk "output carries no secret, token or file content" '! grep -Eq "SECRETVALUE|fixture-token|hc-ping" <<<"$out"'
out=$(SK_GH_API_BASE=http://127.0.0.1:$port GH_TOKEN=wrong python3 "$root/infra/vps/ops-tools/gh_secret.py" o/r BACKUP_ENV_FILE "$t/file" 2>&1); rc=$?
chk "a bad token fails non-zero without leaking" '[ $rc != 0 ] && ! grep -q "wrong" <<<"$out"'
: > "$t/empty"; out=$(SK_GH_API_BASE=http://127.0.0.1:$port GH_TOKEN=fixture-token python3 "$root/infra/vps/ops-tools/gh_secret.py" o/r BACKUP_ENV_FILE "$t/empty" 2>&1); rc=$?
chk "an empty file is refused (the secret is never blanked)" '[ $rc != 0 ]'
out=$(SK_GH_API_BASE=http://evil.example GH_TOKEN=fixture-token python3 "$root/infra/vps/ops-tools/gh_secret.py" o/r BACKUP_ENV_FILE "$t/file" 2>&1); rc=$?
chk "a non-loopback API override is rejected" '[ $rc != 0 ]'
[ $fail = 0 ] && echo "ALL GH-SECRET TESTS PASSED" || { echo "GH-SECRET TEST FAILURES"; exit 1; }
