"""A stand-in application for the isolated release qualification. It answers the same health paths
the real services do. MODE is baked into the image at build time, so each behaviour is a different
immutable digest, exactly as a bad release would be:
  good       healthy at once
  slow       becomes healthy after 6 s (a transient startup condition)
  unhealthy  starts and listens but its health probe answers 500 (a release that boots broken)
  crash      exits immediately (a release that cannot start)
"""
import json, os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROLE = os.environ["STUB_ROLE"]
PORT = int(os.environ.get("STUB_PORT", "3000"))
MODE = open("/stub/mode").read().strip()
if MODE == "crash":
    print("fatal: cannot start; db=postgresql://app_user:Sup3rS3cretPw@postgres:5432/school_kit key=sk_live_abcdefgh12345678 who=parent@example.com", file=sys.stderr)
    sys.exit(3)
STARTED = time.time()
PATHS = {
    "api": {"/api/v1/health", "/api/v1/health/db", "/api/v1/payments/paystack/webhook"},
    "web": {"/staff/login"},
    "portal": {"/api/health"},
    "render": {"/health"},
}[ROLE]


def ready():
    if MODE == "unhealthy":
        return False
    return not (MODE == "slow" and time.time() - STARTED < 6)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _go(self):
        path = self.path.split("?")[0]
        if path not in PATHS:
            self.send_response(404); self.end_headers(); return
        if not ready():
            self.send_response(500); self.end_headers(); self.wfile.write(b"not ready"); return
        body = json.dumps({"status": "ok", "role": "app_user", "service": ROLE}).encode() if path.endswith("/health/db") else b'{"status":"ok"}'
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)

    do_GET = do_POST = _go


ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
