#!/usr/bin/env python3
"""Release tooling for School Kit (stdlib only; runs in CI and on the VPS).

Sub-commands (every one prints JSON or plain lines on stdout, errors on stderr,
and exits non-zero on refusal, so shell callers can `set -e` on it):

  build-manifest   build a release manifest from image digests + the migrations folder
  validate         strict validation of a manifest file
  plan             what would a release change, given the live database and the current release
  rollback-check   may the application go back to an earlier release, given what the database holds
  scan-sql         classify migration files (additive | data | breaking, destructive flag)
  jget             read one field of a JSON file (dotted path), for shell scripts
  event            append one JSON event to the history journal (atomic line, redacted)
  state            read or atomically update the deployment state file
  redact           stdin -> stdout with secrets and personal data masked

Nothing here talks to Docker or to the database. The caller feeds in what the
database holds (`--applied`, rows of _prisma_migrations) so every decision can
be tested with fixtures.
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import re
import sys
import tempfile

SERVICES = ("api", "render-worker", "web", "portal", "cbt")
REQUIRED_SERVICES = ("api", "render-worker", "web", "portal")
# Apply order: background worker first, then the API, then the front ends.
APPLY_ORDER = ("render-worker", "api", "web", "portal", "cbt")
SHA = re.compile(r"^[0-9a-f]{40}$")
DIGEST_REF = re.compile(r"^[a-z0-9][a-z0-9._/:-]*/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$")
MIGRATION_NAME = re.compile(r"^[0-9]{14}_[a-z0-9_]+$")
SCHEMA_VERSION = 1
MANIFEST_KEYS = {
    "schema", "release_id", "git_sha", "built_at", "pg_major", "images",
    "migrate_image", "migrations", "schema_head", "migrations_digest", "note",
    "inputs", "provenance",
}
OPTIONAL_KEYS = {"note", "inputs", "provenance"}
UNITS = SERVICES + ("migrate",)
MIGRATION_KEYS = {"name", "checksum", "class", "destructive", "findings"}
CLASSES = ("additive", "data", "breaking")


class Refusal(Exception):
    """A deliberate, explained refusal (exit status 2)."""


# --------------------------------------------------------------------------- SQL classification

def _strip_sql(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"--[^\n]*", " ", text)
    # Dollar-quoted function bodies are code, not statements: keep them out of
    # the statement scan so `DELETE FROM` inside a function does not look like
    # a migration-time delete. (The function itself is still classified.)
    text = re.sub(r"\$([A-Za-z_]*)\$.*?\$\1\$", " $$body$$ ", text, flags=re.S)
    return text


# (regex, class, destructive, label). First match per rule is recorded; the
# migration's class is the most severe one found (breaking > data > additive).
RULES = [
    (r"\bDROP\s+TABLE\b", "breaking", True, "DROP TABLE"),
    (r"\bDROP\s+COLUMN\b", "breaking", True, "DROP COLUMN"),
    (r"\bDROP\s+TYPE\b", "breaking", True, "DROP TYPE"),
    (r"\bDROP\s+SCHEMA\b", "breaking", True, "DROP SCHEMA"),
    (r"\bTRUNCATE\b", "breaking", True, "TRUNCATE"),
    (r"\bDELETE\s+FROM\b", "data", True, "DELETE FROM"),
    (r"\bDROP\s+FUNCTION\b", "breaking", False, "DROP FUNCTION (an older release may still call it)"),
    (r"\bDROP\s+VIEW\b", "breaking", False, "DROP VIEW"),
    (r"\bRENAME\s+(TO|COLUMN)\b", "breaking", False, "RENAME"),
    (r"\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b", "breaking", False, "ALTER COLUMN TYPE"),
    (r"\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b", "breaking", False, "SET NOT NULL"),
    (r"\bADD\s+(COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+[^,;]*\bNOT\s+NULL\b(?![^,;]*\bDEFAULT\b)", "breaking", False,
     "ADD COLUMN ... NOT NULL without DEFAULT"),
    (r"\bADD\s+CONSTRAINT\b[^;]*\b(CHECK|UNIQUE|FOREIGN\s+KEY|EXCLUDE)\b", "breaking", False,
     "ADD CONSTRAINT (an older release's writes may be refused)"),
    (r"\bCREATE\s+UNIQUE\s+INDEX\b", "breaking", False, "CREATE UNIQUE INDEX (an older release's writes may be refused)"),
    (r"\bDROP\s+(POLICY|TRIGGER)\b", "data", False, "DROP POLICY/TRIGGER"),
    (r"\bUPDATE\s+(?!.*\bSET\s+search_path\b)\S+\s+SET\b", "data", False, "UPDATE (backfill)"),
    (r"\bINSERT\s+INTO\b", "data", False, "INSERT INTO"),
    (r"\bALTER\s+TABLE\b[^;]*\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b", "breaking", False, "DISABLE ROW LEVEL SECURITY"),
    (r"\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b", "breaking", False, "NO FORCE ROW LEVEL SECURITY"),
]
_ORDER = {"additive": 0, "data": 1, "breaking": 2}


_IDENT = r'(?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?'
_CREATED_TABLE = re.compile(r"\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?" + _IDENT, re.I)
_ADDED_COLUMN = re.compile(r"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?" + _IDENT + r"[^;]*?\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?\"?([A-Za-z_][A-Za-z0-9_]*)\"?", re.I | re.S)
_ALTER_TARGET = re.compile(r"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?" + _IDENT, re.I)
_TARGETS = {
    # rule-label prefix -> regex whose group(1) is the table the statement acts on
    "ADD CONSTRAINT": _ALTER_TARGET,
    "SET NOT NULL": _ALTER_TARGET,
    "ADD COLUMN": _ALTER_TARGET,
    "CREATE UNIQUE INDEX": re.compile(r"\bON\s+(?:ONLY\s+)?" + _IDENT, re.I),
    "UPDATE": re.compile(r"\bUPDATE\s+(?:ONLY\s+)?" + _IDENT, re.I),
    "INSERT INTO": re.compile(r"\bINSERT\s+INTO\s+" + _IDENT, re.I),
}


def _statement_columns(stmt: str) -> set[str]:
    """Columns a constraint is declared ON (the local side of a foreign key, the list of a UNIQUE or
    PRIMARY KEY). Empty when the statement is not of one of those shapes: no exemption is then given."""
    cols: set[str] = set()
    for grp in re.findall(r"(?:FOREIGN\s+KEY|UNIQUE|PRIMARY\s+KEY)\s*\(([^)]*)\)", stmt, flags=re.I):
        for c in grp.split(","):
            c = c.strip().strip('"')
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", c):
                cols.add(c)
    return cols


def classify_sql(text: str) -> dict:
    """Most severe class over the statements, ignoring objects the migration itself creates.

    A constraint, unique index or backfill on a table (or new column) created in the SAME migration
    cannot reject or disturb an older release, which has never heard of it. Everything else that
    could is `breaking` (older release may fail on the new schema) or `data` (rewrites rows, so it
    needs a quiet system)."""
    body = _strip_sql(text)
    created = {m.group(1).lower() for m in _CREATED_TABLE.finditer(body)}
    added: dict[str, set[str]] = {}
    for m in _ADDED_COLUMN.finditer(body):
        added.setdefault(m.group(1).lower(), set()).add(m.group(2).lower())
    cls, destructive, findings = "additive", False, []
    for stmt in (x for x in body.split(";") if x.strip()):
        for pattern, rule_cls, rule_destructive, label in RULES:
            if not re.search(pattern, stmt, flags=re.I | re.S):
                continue
            target = None
            for prefix, rx in _TARGETS.items():
                if label.startswith(prefix):
                    t = rx.search(stmt)
                    target = t.group(1).lower() if t else None
                    break
            if target and target in created:
                continue
            if label.startswith(("ADD CONSTRAINT", "SET NOT NULL")) and target in added:
                touched = {c.lower() for c in _statement_columns(stmt)}
                if touched and touched <= added[target]:
                    continue
            findings.append(label)
            if _ORDER[rule_cls] > _ORDER[cls]:
                cls = rule_cls
            destructive = destructive or rule_destructive
    return {"class": cls, "destructive": destructive, "findings": sorted(set(findings))}


def prisma_checksum(path: str) -> str:
    """Prisma stores the SHA-256 (hex) of migration.sql in _prisma_migrations.checksum."""
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def scan_migrations(folder: str) -> list[dict]:
    out = []
    for name in sorted(os.listdir(folder)):
        sql = os.path.join(folder, name, "migration.sql")
        if not os.path.isfile(sql):
            continue
        if not MIGRATION_NAME.match(name):
            raise Refusal(f"unexpected migration folder name: {name}")
        with open(sql, encoding="utf-8") as fh:
            info = classify_sql(fh.read())
        out.append({"name": name, "checksum": prisma_checksum(sql), **info})
    return out


def migrations_digest(migrations: list[dict]) -> str:
    h = hashlib.sha256()
    for m in migrations:
        h.update(f"{m['name']} {m['checksum']}\n".encode())
    return h.hexdigest()


# --------------------------------------------------------------------------- manifest

def _pairs(items):
    out = {}
    for pair in items or []:
        k, sep, v = pair.partition("=")
        if not sep or k not in UNITS:
            raise Refusal(f"bad unit pair: {pair[:60]!r}")
        out[k] = v
    return out


def need_build(previous: dict | None, inputs: dict, with_cbt: bool = False) -> list[str]:
    """Units whose image must be built: no previous release, or their inputs differ from it. A unit
    the previous release did not ship (the exam app) is built only when asked for."""
    want = []
    for unit in UNITS:
        if unit == "cbt" and not with_cbt and not (previous and "cbt" in previous["images"]):
            continue
        if unit not in inputs:
            raise Refusal(f"no inputs hash for unit {unit}")
        if previous is None or previous.get("inputs", {}).get(unit) != inputs[unit]:
            want.append(unit)
            continue
        have = previous["migrate_image"] if unit == "migrate" else previous["images"].get(unit)
        if not have:
            want.append(unit)
    return want


def build_manifest(a) -> dict:
    migrations = scan_migrations(a.migrations_dir)
    built = _pairs(a.built)
    for pair in a.image:  # legacy form: every unit given is "built now"
        svc, _, ref = pair.partition("=")
        built[svc] = ref
    if a.migrate_image:
        built["migrate"] = a.migrate_image
    inputs = _pairs(a.input)
    previous = load_manifest(a.previous) if a.previous else None
    images, provenance, used_inputs = {}, {}, {}
    migrate_image = None
    for unit in UNITS:
        if unit in built:
            ref, prov = built[unit], a.git_sha
        elif previous is not None and unit in inputs and previous.get("inputs", {}).get(unit) == inputs[unit]:
            ref = previous["migrate_image"] if unit == "migrate" else previous["images"].get(unit)
            prov = previous.get("provenance", {}).get(unit, previous["git_sha"])
            if not ref:
                continue
        else:
            continue
        if unit == "migrate":
            migrate_image = ref
        else:
            images[unit] = ref
        provenance[unit] = prov
        if unit in inputs:
            used_inputs[unit] = inputs[unit]
    if migrate_image is None:
        raise Refusal("the migration runner image is neither built nor reusable (its inputs changed or there is no previous release)")
    for svc in REQUIRED_SERVICES:
        if svc not in images:
            raise Refusal(f"unit {svc} is neither built nor reusable: build it")
    built_at = a.built_at or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    stamp = re.sub(r"[^0-9]", "", built_at)[:14]
    manifest = {
        "schema": SCHEMA_VERSION,
        "release_id": f"{stamp[:8]}T{stamp[8:]}Z-{a.git_sha[:12]}",
        "git_sha": a.git_sha,
        "built_at": built_at,
        "pg_major": int(a.pg_major),
        "images": images,
        "migrate_image": migrate_image,
        "migrations": migrations,
        "schema_head": migrations[-1]["name"] if migrations else "",
        "migrations_digest": migrations_digest(migrations),
        "provenance": provenance,
    }
    if used_inputs:
        manifest["inputs"] = used_inputs
    if a.note:
        manifest["note"] = a.note
    validate_manifest(manifest, registry_prefixes=a.registry_prefix or None)
    return manifest


def validate_manifest(m: dict, registry_prefixes=None) -> None:
    if not isinstance(m, dict):
        raise Refusal("manifest is not an object")
    extra = set(m) - MANIFEST_KEYS
    if extra:
        raise Refusal(f"unexpected manifest keys: {sorted(extra)}")
    missing = (MANIFEST_KEYS - OPTIONAL_KEYS) - set(m)
    if missing:
        raise Refusal(f"manifest is missing keys: {sorted(missing)}")
    if m["schema"] != SCHEMA_VERSION:
        raise Refusal(f"unsupported manifest schema {m['schema']!r}")
    if not isinstance(m["git_sha"], str) or not SHA.match(m["git_sha"]):
        raise Refusal("git_sha is not a 40-hex commit")
    if not re.match(r"^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$", str(m["release_id"])) or not m["release_id"].endswith(m["git_sha"][:12]):
        raise Refusal("release_id must be <UTC stamp>-<first 12 of git_sha>")
    if not isinstance(m["pg_major"], int) or not 12 <= m["pg_major"] <= 30:
        raise Refusal("pg_major is not a plausible PostgreSQL major version")
    images = m["images"]
    if not isinstance(images, dict):
        raise Refusal("images must be an object")
    for svc in REQUIRED_SERVICES:
        if svc not in images:
            raise Refusal(f"images.{svc} is missing")
    prefixes = registry_prefixes or [p for p in os.environ.get("RELEASE_REGISTRY_ALLOW", "ghcr.io/voclain1/").split(",") if p]
    for svc, ref in list(images.items()) + [("migrate_image", m["migrate_image"])]:
        if svc != "migrate_image" and svc not in SERVICES:
            raise Refusal(f"unknown service {svc!r}")
        if not isinstance(ref, str) or not DIGEST_REF.match(ref):
            raise Refusal(f"{svc}: not an immutable name@sha256:<64 hex> reference (tags are refused)")
        if not any(ref.startswith(p) for p in prefixes):
            raise Refusal(f"{svc}: registry/namespace is not on the allow-list")
    for key in ("inputs", "provenance"):
        block = m.get(key, {})
        if not isinstance(block, dict) or any(u not in UNITS for u in block):
            raise Refusal(f"{key} must map known units to values")
    for unit, sha in m.get("provenance", {}).items():
        if not isinstance(sha, str) or not SHA.match(sha):
            raise Refusal(f"provenance.{unit} is not a 40-hex commit")
    for unit, h in m.get("inputs", {}).items():
        if not isinstance(h, str) or not re.match(r"^[0-9a-f-]{8,80}$", h):
            raise Refusal(f"inputs.{unit} is not a hash")
    seen = set()
    prev = ""
    for mig in m["migrations"]:
        if set(mig) != MIGRATION_KEYS:
            raise Refusal(f"migration entry has unexpected shape: {mig.get('name')}")
        if not MIGRATION_NAME.match(mig["name"]) or mig["name"] in seen:
            raise Refusal(f"bad or duplicate migration name {mig['name']!r}")
        if not re.match(r"^[0-9a-f]{64}$", mig["checksum"]):
            raise Refusal(f"{mig['name']}: checksum is not SHA-256 hex")
        if mig["class"] not in CLASSES:
            raise Refusal(f"{mig['name']}: class must be one of {CLASSES}")
        if mig["name"] < prev:
            raise Refusal("migrations are not in ascending name order")
        seen.add(mig["name"])
        prev = mig["name"]
    head = m["migrations"][-1]["name"] if m["migrations"] else ""
    if m["schema_head"] != head:
        raise Refusal("schema_head is not the last migration")
    if m["migrations_digest"] != migrations_digest(m["migrations"]):
        raise Refusal("migrations_digest does not match the migration list")


def load_manifest(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def canonical_bytes(m: dict) -> bytes:
    return (json.dumps(m, indent=2, sort_keys=True) + "\n").encode()


# --------------------------------------------------------------------------- planning

def parse_applied(path: str) -> list[dict]:
    """Rows of _prisma_migrations as tab-separated: name, checksum, finished(t/f), rolled_back(t/f)."""
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) != 4 or parts[2] not in ("t", "f") or parts[3] not in ("t", "f"):
                raise Refusal(f"unparsable _prisma_migrations row: {line[:60]!r}")
            rows.append({"name": parts[0], "checksum": parts[1], "finished": parts[2] == "t", "rolled_back": parts[3] == "t"})
    return rows


def make_plan(m: dict, current: dict | None, applied: list[dict]) -> dict:
    blockers, notes = [], []
    cur_images = (current or {}).get("images", {})
    changed = [s for s in APPLY_ORDER if s in m["images"] and cur_images.get(s) != m["images"][s]]
    if current is None:
        notes.append("no current release is recorded: run `release.sh adopt` first")
        blockers.append("NO_BASELINE")
    live = {}
    for row in applied:
        if row["rolled_back"] or not row["finished"]:
            continue  # neither a rolled-back attempt nor a FAILED one is applied; a failed one is reported as unresolved below
        live[row["name"]] = row
    unresolved = [r["name"] for r in applied if not r["finished"] and not r["rolled_back"]]
    if unresolved:
        blockers.append("UNRESOLVED_MIGRATION:" + ",".join(unresolved))
    by_name = {x["name"]: x for x in m["migrations"]}
    mismatched = [n for n, r in live.items() if n in by_name and r["checksum"] != by_name[n]["checksum"]]
    if mismatched:
        blockers.append("CHECKSUM_MISMATCH:" + ",".join(mismatched))
    pending = [x for x in m["migrations"] if x["name"] not in live]
    ahead = sorted(n for n in live if n not in by_name)
    latest_applied = max(live) if live else ""
    out_of_order = [x["name"] for x in pending if x["name"] < latest_applied]
    if out_of_order:
        blockers.append("OUT_OF_ORDER_MIGRATION:" + ",".join(out_of_order))
    kind = "FORWARD"
    if ahead:
        known = {x["name"]: x for x in (current or {}).get("migrations", [])}
        bad = [n for n in ahead if n not in known or known[n]["class"] == "breaking"]
        if bad:
            blockers.append("DATABASE_AHEAD_OF_RELEASE:" + ",".join(bad))
        else:
            kind = "ROLLBACK_LIKE"
            notes.append("database holds migrations this release does not know; all are rollback-safe")
    breaking = any(x["class"] == "breaking" for x in pending)
    data = any(x["class"] == "data" for x in pending)
    destructive = any(x["destructive"] for x in pending)
    klass = "NOOP" if not changed and not pending else ("SCHEMA" if pending else "APP_ONLY")
    return {
        "release_id": m["release_id"],
        "kind": kind,
        "class": klass,
        "services_changed": changed,
        "pending": [{"name": x["name"], "class": x["class"], "destructive": x["destructive"], "findings": x["findings"]} for x in pending],
        "needs_maintenance": breaking or data,
        "breaking": breaking,
        "destructive": destructive,
        "rollback_allowed_after": not breaking,
        "needs_approval": klass == "SCHEMA" or kind == "ROLLBACK_LIKE",
        "blockers": blockers,
        "notes": notes,
    }


def rollback_check(current: dict, target: dict, applied: list[dict]) -> dict:
    reasons = []
    live = {r["name"] for r in applied if r["finished"] and not r["rolled_back"]}
    known = {x["name"]: x for x in current.get("migrations", [])}
    target_names = {x["name"] for x in target["migrations"]}
    extras = sorted(live - target_names)
    for name in extras:
        info = known.get(name)
        if info is None:
            reasons.append(f"{name}: applied but not in the current release's manifest (unknown compatibility)")
        elif info["class"] == "breaking":
            reasons.append(f"{name}: breaking migration; the earlier release may not work on this schema")
    if target["pg_major"] != current["pg_major"]:
        reasons.append("PostgreSQL major version differs between the two releases")
    return {"allowed": not reasons, "extras": extras, "reasons": reasons}


# --------------------------------------------------------------------------- Caddy maintenance rewriting
MAINT_HEADER = '\theader Retry-After "120"\n\trespond "Maintenance in progress. Please retry shortly." 503\n'
SK_HOST_BLOCK = re.compile(r"^\{\$(API|WEB|PORTAL)_HOST\} \{$")


def maintenance_caddyfile(text: str, mark: str) -> str:
    """Replace ONLY School Kit's three host blocks with a 503 + Retry-After; every other line (global
    options, snippets, imports, any other site) is copied byte for byte."""
    out, skip, n = [], False, 0
    for line in text.splitlines(keepends=True):
        if not skip and SK_HOST_BLOCK.match(line.rstrip("\n")):
            out += [mark + "\n", line, MAINT_HEADER]
            skip, n = True, n + 1
            continue
        if skip:
            if line.rstrip("\n") == "}":
                skip = False
                out.append(line)
            continue
        out.append(line)
    if n != 3:
        raise Refusal(f"expected the API, web and portal host blocks (found {n}); refusing to guess")
    return "".join(out)


def maintenance_site(text: str) -> str:
    """A site file (e.g. the school-address wildcard) in maintenance: same address line, same `tls`
    block (so a certificate still loads), every handler replaced by a 503."""
    lines = text.splitlines()
    head = next((i for i, l in enumerate(lines) if l.rstrip().endswith("{") and not l.startswith((" ", "\t"))), None)
    if head is None:
        raise Refusal("site file has no top-level block")
    out, depth, in_tls = [lines[head]], 0, False
    for line in lines[head + 1:]:
        stripped = line.strip()
        # balanced inline placeholders such as {env.X} do not change the depth
        depth_change = len(re.findall(r"\{(?![$a-z_.]+\})", stripped)) - len(re.findall(r"(?<![$a-z_.])\}", stripped))
        if depth == 0 and re.match(r"^tls\s*\{", stripped):
            in_tls = True
        if in_tls:
            out.append(line)
        depth += depth_change
        if in_tls and depth == 0:
            in_tls = False
        if depth < 0:
            break
    out.append(MAINT_HEADER.rstrip("\n"))
    out.append("}")
    return "\n".join(out) + "\n"


def verify_maintenance_caddyfile(original: str, candidate: str, mark: str) -> None:
    """The file on disk must be EXACTLY what the rewriter generates from the original. A truncated or
    half-written file can still be a valid Caddyfile (a comment is valid), and Caddy would load it and
    serve nothing; so validity is not enough, equality with the intended content is required."""
    if candidate != maintenance_caddyfile(original, mark):
        raise Refusal("the maintenance Caddyfile is not what was generated from the original (partial write?)")


def verify_maintenance_site(original: str, candidate: str) -> None:
    if candidate != maintenance_site(original):
        raise Refusal("the maintenance site file is not what was generated from the original (partial write?)")


# --------------------------------------------------------------------------- Caddy routing equivalence
# `caddy adapt` names route groups group0, group1, ... in the order it meets them across the WHOLE
# Caddyfile. Adding or removing one site that uses `handle` renumbers every later site's groups without
# changing any routing. A byte or JSON comparison of two configs would call that a difference, and a
# check that "ignores group names" outright would also miss a real change. Normalisation here renames
# groups by first appearance within the compared subset, consistently (one name to one name), so the
# STRUCTURE (which routes share a group) is still compared, and only the arbitrary numbers are not.
_GROUP = re.compile(r"^group\d+$")


def caddy_normalize(obj):
    names: dict[str, str] = {}

    def walk(o):
        if isinstance(o, dict):
            out = {}
            for k, v in o.items():  # insertion order = the order Caddy emitted
                if k == "group" and isinstance(v, str) and _GROUP.match(v):
                    out[k] = names.setdefault(v, f"G{len(names)}")
                else:
                    out[k] = walk(v)
            return out
        if isinstance(o, list):
            return [walk(x) for x in o]
        return o

    return walk(obj)


def _hosts_of(route) -> list[str]:
    hosts: list[str] = []
    for m in route.get("match", []) or []:
        hosts += [h for h in (m.get("host") or []) if isinstance(h, str)]
    return hosts


def caddy_site_routes(config: dict, host: str) -> str:
    """The routes of one site (those matching `host`), normalised on their own so that a renumbering caused
    by OTHER sites cannot show up as a difference in THIS one."""
    routes = []
    for srv in (config.get("apps", {}).get("http", {}).get("servers", {}) or {}).values():
        for r in srv.get("routes", []) or []:
            if host in _hosts_of(r):
                routes.append(r)
    return json.dumps(caddy_normalize(routes), sort_keys=True)


def caddy_servers(config: dict) -> str:
    """Normalised routing of the whole HTTP app (what 'the same Caddy configuration' means for equivalence)."""
    return json.dumps(caddy_normalize(config.get("apps", {}).get("http", {}).get("servers", {})), sort_keys=True)


# --------------------------------------------------------------------------- Caddy write intent and recovery
# A maintenance window rewrites Caddy's files IN PLACE (a single-file bind mount keeps its inode only if the same
# file is written). That write is not atomic: a crash can leave a PREFIX of the intended content on disk. Recovery must
# repair exactly that, and must never "repair" a file somebody else edited, so the durable record carries evidence:
#   * the sha256 of the original and of the maintenance version of each file, and of the full copies kept beside it;
#   * the inode of each live file when the record was written (an editor that replaces a file changes it);
#   * the WRITE INTENT: which direction (to_maintenance | to_original) and whether it is pending or done.
# A live file is "interrupted" only when ALL of these hold: the intent is pending, the file is neither recorded
# version, it is the same inode, and its bytes are a strict prefix of the content being written. Anything else that
# differs from the record is an unrelated edit, which is reported and never overwritten.
CADDY_RECORD = "caddy.record.json"


def _sha_path(path: str) -> str | None:
    try:
        with open(path, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except OSError:
        return None


def _read_bytes(path: str) -> bytes | None:
    try:
        with open(path, "rb") as fh:
            return fh.read()
    except OSError:
        return None


def _caddy_copies(d: str) -> dict:
    return {
        "caddyfile": (os.path.join(d, "Caddyfile.pre-release"), os.path.join(d, "Caddyfile.maintenance")),
        "site": (os.path.join(d, "sites.pre-release", "school-addresses.caddy"), os.path.join(d, "school-addresses.maintenance")),
    }


def caddy_record_build(d: str, caddyfile: str, site: str) -> dict:
    files = {}
    for name, live in (("caddyfile", caddyfile), ("site", site)):
        orig, maint = _caddy_copies(d)[name]
        if name == "site" and not os.path.exists(orig):
            continue
        files[name] = {"live": live, "original_sha": _sha_path(orig), "maintenance_sha": _sha_path(maint),
                       "ino": os.stat(live).st_ino}
        if not files[name]["original_sha"] or not files[name]["maintenance_sha"]:
            raise Refusal(f"cannot record {name}: a saved copy is missing")
    return {"version": 2, "written_at": now(), "files": files, "intent": {"direction": None, "status": "none"}}


def caddy_record_load(d: str) -> dict | None:
    try:
        with open(os.path.join(d, CADDY_RECORD), encoding="utf-8") as fh:
            rec = json.load(fh)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as e:
        raise Refusal(f"the Caddy recovery record is unreadable: {e}")
    if not isinstance(rec, dict) or rec.get("version") != 2 or not isinstance(rec.get("files"), dict) or "caddyfile" not in rec["files"]:
        raise Refusal("the Caddy recovery record has an unknown shape")
    return rec


def caddy_record_save(d: str, rec: dict) -> None:
    atomic_write(os.path.join(d, CADDY_RECORD), (json.dumps(rec, indent=2, sort_keys=True) + "\n").encode())


def caddy_record_intent(d: str, direction: str, status: str) -> None:
    if direction not in ("to_maintenance", "to_original") or status not in ("pending", "done"):
        raise Refusal("bad write intent")
    rec = caddy_record_load(d)
    if rec is None:
        raise Refusal("no Caddy recovery record to record an intent on")
    rec["intent"] = {"direction": direction, "status": status, "at": now()}
    caddy_record_save(d, rec)


def caddy_classify(d: str, container_ino: str | None = None) -> tuple[str, str, str]:
    """-> (verdict, direction, detail). Verdicts: NO_RECORD, CONSISTENT, INTERRUPTED, UNRELATED_EDIT, RECORD_INVALID."""
    try:
        rec = caddy_record_load(d)
    except Refusal as e:
        return "RECORD_INVALID", "", str(e)
    if rec is None:
        return "NO_RECORD", "", "no maintenance window is recorded"
    intent = rec.get("intent") or {}
    direction, pending = intent.get("direction") or "", intent.get("status") == "pending"
    copies = _caddy_copies(d)
    for name, ent in rec["files"].items():
        orig, maint = copies[name]
        if _sha_path(orig) != ent["original_sha"] or _sha_path(maint) != ent["maintenance_sha"]:
            return "RECORD_INVALID", "", f"the saved copy of {name} does not match its recorded checksum"
    interrupted = []
    for name, ent in rec["files"].items():
        live = ent["live"]
        cur = _sha_path(live)
        if cur is None:
            return "UNRELATED_EDIT", "", f"{live} is missing"
        if cur in (ent["original_sha"], ent["maintenance_sha"]):
            continue
        if not pending:
            return "UNRELATED_EDIT", "", f"{live} matches neither recorded version and no write was in progress"
        if os.stat(live).st_ino != ent["ino"]:
            return "UNRELATED_EDIT", "", f"{live} is a different file (inode changed) from the one the window was recorded on"
        want = _read_bytes(copies[name][1] if direction == "to_maintenance" else copies[name][0]) or b""
        have = _read_bytes(live) or b""
        if not (len(have) < len(want) and want.startswith(have)):
            return "UNRELATED_EDIT", "", f"{live} is not a prefix of the content being written (not a partial write)"
        interrupted.append(name)
    if not interrupted:
        return "CONSISTENT", direction, "every Caddy file is one of its recorded versions"
    if container_ino is not None and str(container_ino) != str(rec["files"]["caddyfile"]["ino"]):
        return "UNRELATED_EDIT", "", "the container's Caddyfile is not the host file the window was recorded on (bind-mount identity differs)"
    return "INTERRUPTED", direction, "interrupted write of " + ", ".join(interrupted)


# --------------------------------------------------------------------------- durable acceptance
def acceptance_check(d: str) -> tuple[bool, str]:
    """COMPLETE is final only with a durable record that names THIS release id and THIS manifest checksum, and the manifest
    kept for the release must be byte-identical to what was accepted."""
    try:
        with open(os.path.join(d, "state.json"), encoding="utf-8") as fh:
            st = json.load(fh)
    except (OSError, ValueError):
        return False, "no readable release state"
    rid, sha = st.get("release_id"), st.get("manifest_sha256")
    if not rid or not sha or not re.match(r"^[A-Za-z0-9._-]+$", str(rid)):
        return False, "the state names no release id / manifest checksum"
    if st.get("accepted") is not True:
        return False, "the state does not say the release was accepted"
    try:
        with open(os.path.join(d, "acceptance", f"{rid}.json"), encoding="utf-8") as fh:
            rec = json.load(fh)
    except (OSError, ValueError):
        return False, f"acceptance record acceptance/{rid}.json is missing or unreadable"
    if rec.get("release_id") != rid:
        return False, "the acceptance record is for a different release id"
    if rec.get("manifest_sha256") != sha:
        return False, "the acceptance record is for a different manifest checksum"
    if not rec.get("accepted_at"):
        return False, "the acceptance record has no timestamp"
    kept = _sha_path(os.path.join(d, "releases", str(rid), "manifest.json"))
    if kept is not None and kept != sha:
        return False, "the manifest kept for this release differs from the accepted checksum"
    return True, f"release {rid} accepted with manifest {sha[:12]}"


# --------------------------------------------------------------------------- production route accounting
SK_UPSTREAM_NAMES = {"api", "web", "portal", "cbt", "render-worker", "postgres", "redis"}
SK_LOOPBACK_PORTS = {"3000", "3001", "3002", "3003", "4000", "4001"}


def _dials(o) -> list[str]:
    found: list[str] = []
    if isinstance(o, dict):
        for u in o.get("upstreams", []) or []:
            if isinstance(u, dict) and isinstance(u.get("dial"), str):
                found.append(u["dial"])
        for v in o.values():
            found += _dials(v)
    elif isinstance(o, list):
        for v in o:
            found += _dials(v)
    return found


def _is_sk_dial(dial: str) -> bool:
    host, _, port = dial.rpartition(":")
    host = (host or dial).strip("[]").lower()
    return host in SK_UPSTREAM_NAMES or (host in ("127.0.0.1", "localhost", "::1", "host.docker.internal") and port in SK_LOOPBACK_PORTS)


def _host_only(value: str) -> str:
    value = re.sub(r"^https?://", "", value.strip().strip("\"'"))
    return value.split("/")[0].split(":")[0].lower()


def _subst_env(text: str, env: dict) -> str | None:
    unresolved = []

    def sub(m):
        v = env.get(m.group(1), m.group(2))
        if v is None:
            unresolved.append(m.group(1))
            return m.group(0)
        return v

    out = re.sub(r"\{\$([A-Za-z0-9_]+)(?::([^}]*))?\}", sub, text)
    return None if unresolved or "{env." in out else out


def site_file_hosts(text: str, env: dict) -> tuple[list[str], list[str]]:
    """Addresses of the top-level site blocks in one site file -> (resolved hosts, addresses that could not be resolved)."""
    hosts, bad = [], []
    for line in text.splitlines():
        if not line or line[0] in " \t#}(" or line.startswith("import ") or not line.rstrip().endswith("{"):
            continue
        for addr in re.split(r"[,\s]+", line.rstrip()[:-1].strip()):
            if not addr:
                continue
            resolved = _subst_env(addr, env)
            (hosts if resolved else bad).append(_host_only(resolved) if resolved else addr)
    return hosts, bad


def caddy_route_audit(config: dict, managed: set[str], accepted: dict[str, str], expected_site_hosts: list[str], unresolved: list[str]) -> dict:
    """Account for every route in the adapted configuration before a maintenance window.
    maintained = hosts the maintenance rewrite closes; unrelated = routes that reach nothing of School Kit's;
    accepted_live = School Kit upstreams an operator decided, in writing, may stay up; unclassified = anything else
    that reaches a School Kit upstream (REJECTED); missing = a site file whose host is not in the adapted configuration."""
    rep = {"maintained": [], "unrelated": [], "accepted_live": [], "unclassified": [], "missing": [], "unresolved": sorted(unresolved)}
    seen: set[str] = set()
    for srv in (config.get("apps", {}).get("http", {}).get("servers", {}) or {}).values():
        for r in srv.get("routes", []) or []:
            hosts = [h.lower() for h in _hosts_of(r)]
            seen.update(hosts)
            sk = sorted({x for x in _dials(r) if _is_sk_dial(x)})
            label = ",".join(hosts) or "(any host)"
            if hosts and all(h in managed for h in hosts):
                rep["maintained"].append(label)
            elif not sk:
                rep["unrelated"].append(label)
            elif hosts and all(h in managed or h in accepted for h in hosts):
                rep["accepted_live"].append(label)
            else:
                rep["unclassified"].append({"hosts": label, "upstreams": sk})
    rep["missing"] = sorted(h for h in set(expected_site_hosts) if h not in seen)
    rep["ok"] = not (rep["unclassified"] or rep["missing"] or rep["unresolved"])
    return rep


# --------------------------------------------------------------------------- redaction

_REDACTIONS = [
    (re.compile(r"(?i)\b(postgres(?:ql)?|redis|amqp|mysql)://[^\s:@/]+:[^\s@/]+@"), r"\1://***:***@"),
    (re.compile(r"\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}"), r"\1_\2_***"),
    (re.compile(r"\bwhsec_[A-Za-z0-9+/=]{8,}"), "whsec_***"),
    (re.compile(r"\bre_[A-Za-z0-9]{12,}"), "re_***"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), "gh*_***"),
    (re.compile(r"\bsk-ant-[A-Za-z0-9_-]{10,}"), "sk-ant-***"),
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{12,}"), r"\1 ***"),
    (re.compile(r"(?i)(authorization|x-paystack-signature|x-hub-signature(?:-256)?|cookie|set-cookie)\s*[:=]\s*[^\r\n]+"), r"\1: ***"),
    (re.compile(r"(?i)\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|ACCESS_KEY(?:_ID)?|HMAC_KEY|DSN)[A-Z0-9_]*)\s*=\s*\S+"), r"\1=***"),
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "<email>"),
    (re.compile(r"(?<![\d.])(?:\+?234|0)[789][01]\d{8}(?!\d)"), "<phone>"),
    (re.compile(r"\b[0-9]{10}\b(?=.*\b(?:account|bvn|nin)\b)", re.I), "<number>"),
    (re.compile(r"\b(?:eyJ[A-Za-z0-9_-]{8,}\.){2}[A-Za-z0-9_-]{8,}"), "<jwt>"),
]


def redact(text: str) -> str:
    for pattern, repl in _REDACTIONS:
        text = pattern.sub(repl, text)
    return text


# --------------------------------------------------------------------------- journal and state

def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def atomic_write(path: str, data: bytes, mode: int = 0o600) -> None:
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(prefix=".tmp.", dir=d)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def kv_pairs(items: list[str]) -> dict:
    out = {}
    for item in items:
        k, sep, v = item.partition("=")
        if not sep or not re.match(r"^[a-z_][a-z0-9_]*$", k):
            raise Refusal(f"bad key=value: {item[:40]!r}")
        if v in ("true", "false"):
            out[k] = v == "true"
        elif re.match(r"^-?[0-9]+$", v):
            out[k] = int(v)
        else:
            out[k] = redact(v)
    return out


def append_event(path: str, kind: str, fields: dict) -> None:
    line = json.dumps({"ts": now(), "event": kind, **fields}, sort_keys=True) + "\n"
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        os.write(fd, line.encode())  # one write(2) = one atomic line for concurrent appenders
        os.fsync(fd)
    finally:
        os.close(fd)


def dotted(obj, path: str):
    for part in path.split("."):
        if isinstance(obj, list):
            obj = obj[int(part)]
        else:
            obj = obj[part]
    return obj


# --------------------------------------------------------------------------- CLI

def out(obj) -> None:
    print(json.dumps(obj, indent=2, sort_keys=True))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="release_tool.py")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build-manifest")
    b.add_argument("--git-sha", required=True)
    b.add_argument("--pg-major", required=True)
    b.add_argument("--migrations-dir", required=True)
    b.add_argument("--migrate-image")
    b.add_argument("--image", action="append", default=[], help="service=ref@sha256:... (built now)")
    b.add_argument("--built", action="append", default=[], help="unit=ref@sha256:... (built now; includes migrate)")
    b.add_argument("--input", action="append", default=[], help="unit=inputs-hash")
    b.add_argument("--previous", help="the release currently running; unchanged units are reused from it")
    b.add_argument("--registry-prefix", action="append")
    b.add_argument("--built-at")
    b.add_argument("--note")
    b.add_argument("--out", required=True)

    v = sub.add_parser("validate")
    v.add_argument("manifest")
    v.add_argument("--registry-prefix", action="append")

    pl = sub.add_parser("plan")
    pl.add_argument("--manifest", required=True)
    pl.add_argument("--current")
    pl.add_argument("--applied", required=True)

    rb = sub.add_parser("rollback-check")
    rb.add_argument("--current", required=True)
    rb.add_argument("--target", required=True)
    rb.add_argument("--applied", required=True)

    sc = sub.add_parser("scan-sql")
    sc.add_argument("files", nargs="+")

    jg = sub.add_parser("jget")
    jg.add_argument("file")
    jg.add_argument("path")

    ev = sub.add_parser("event")
    ev.add_argument("--file", required=True)
    ev.add_argument("kind")
    ev.add_argument("fields", nargs="*")

    st = sub.add_parser("state")
    st.add_argument("action", choices=["get", "set", "init"])
    st.add_argument("--file", required=True)
    st.add_argument("fields", nargs="*")

    mc = sub.add_parser("maintenance-caddyfile")
    mc.add_argument("infile"); mc.add_argument("outfile"); mc.add_argument("--mark", required=True)
    ms = sub.add_parser("maintenance-site")
    ms.add_argument("infile"); ms.add_argument("outfile")
    mv = sub.add_parser("maintenance-verify")
    mv.add_argument("original"); mv.add_argument("candidate"); mv.add_argument("--mark"); mv.add_argument("--site", action="store_true")
    nb = sub.add_parser("need-build")
    nb.add_argument("--previous"); nb.add_argument("--input", action="append", default=[]); nb.add_argument("--with-cbt", action="store_true")
    sm = sub.add_parser("summary")
    sm.add_argument("manifest")
    ce = sub.add_parser("caddy-equivalent", help="exit 0 when two `caddy adapt` / live configs route identically (group ids normalised)")
    ce.add_argument("a"); ce.add_argument("b"); ce.add_argument("--host", help="compare only the routes of this host")
    cr = sub.add_parser("caddy-record", help="write the durable Caddy recovery record, or set its write intent")
    cr.add_argument("action", choices=["write", "intent"]); cr.add_argument("--dir", required=True)
    cr.add_argument("--caddyfile", default="Caddyfile"); cr.add_argument("--site", default="sites/school-addresses.caddy")
    cr.add_argument("--direction"); cr.add_argument("--status")
    cc = sub.add_parser("caddy-classify", help="what state are Caddy's files in, judged against the durable record")
    cc.add_argument("--dir", required=True); cc.add_argument("--container-ino")
    ac = sub.add_parser("acceptance-check", help="exit 0 only when COMPLETE has a durable acceptance record matching the release id and manifest checksum")
    ac.add_argument("--dir", required=True)
    ra = sub.add_parser("caddy-route-audit", help="account for every route of the adapted Caddy configuration before maintenance")
    ra.add_argument("adapted"); ra.add_argument("--env-file", required=True); ra.add_argument("--sites-dir", default="sites")
    ra.add_argument("--decisions"); ra.add_argument("--managed-site", default="school-addresses.caddy")
    sub.add_parser("redact")

    a = p.parse_args(argv)
    try:
        if a.cmd == "build-manifest":
            m = build_manifest(a)
            atomic_write(a.out, canonical_bytes(m), 0o644)
            print(a.out)
        elif a.cmd == "need-build":
            prev = load_manifest(a.previous) if a.previous and os.path.exists(a.previous) else None
            print(json.dumps(need_build(prev, _pairs(a.input), a.with_cbt)))
        elif a.cmd == "summary":
            m = load_manifest(a.manifest)
            m["migrations"] = {"count": len(m["migrations"]), "head": m["schema_head"],
                               "by_class": {c: sum(1 for x in m["migrations"] if x["class"] == c) for c in CLASSES}}
            out(m)
        elif a.cmd == "validate":
            validate_manifest(load_manifest(a.manifest), a.registry_prefix)
            print("ok")
        elif a.cmd == "plan":
            m = load_manifest(a.manifest)
            validate_manifest(m)
            cur = load_manifest(a.current) if a.current and os.path.exists(a.current) else None
            out(make_plan(m, cur, parse_applied(a.applied)))
        elif a.cmd == "rollback-check":
            res = rollback_check(load_manifest(a.current), load_manifest(a.target), parse_applied(a.applied))
            out(res)
            return 0 if res["allowed"] else 3
        elif a.cmd == "scan-sql":
            for f in a.files:
                with open(f, encoding="utf-8") as fh:
                    print(f, json.dumps(classify_sql(fh.read()), sort_keys=True))
        elif a.cmd == "jget":
            val = dotted(load_manifest(a.file), a.path)
            print(val if isinstance(val, str) else json.dumps(val))
        elif a.cmd == "event":
            append_event(a.file, a.kind, kv_pairs(a.fields))
        elif a.cmd == "state":
            cur = {}
            if os.path.exists(a.file):
                with open(a.file, encoding="utf-8") as fh:
                    cur = json.load(fh)
            if a.action == "get":
                out(cur)
            else:
                new = {} if a.action == "init" else cur
                new.update(kv_pairs(a.fields))
                new["updated_at"] = now()
                atomic_write(a.file, (json.dumps(new, indent=2, sort_keys=True) + "\n").encode())
        elif a.cmd == "maintenance-caddyfile":
            with open(a.infile, encoding="utf-8") as fh:
                atomic_write(a.outfile, maintenance_caddyfile(fh.read(), a.mark).encode(), 0o644)
        elif a.cmd == "maintenance-site":
            with open(a.infile, encoding="utf-8") as fh:
                atomic_write(a.outfile, maintenance_site(fh.read()).encode(), 0o644)
        elif a.cmd == "maintenance-verify":
            with open(a.original, encoding="utf-8") as fo, open(a.candidate, encoding="utf-8") as fc:
                if a.site:
                    verify_maintenance_site(fo.read(), fc.read())
                else:
                    verify_maintenance_caddyfile(fo.read(), fc.read(), a.mark)
        elif a.cmd == "caddy-equivalent":
            ca, cb = load_manifest(a.a), load_manifest(a.b)
            if a.host:
                same = caddy_site_routes(ca, a.host) == caddy_site_routes(cb, a.host) and caddy_site_routes(ca, a.host) != "[]"
            else:
                same = caddy_servers(ca) == caddy_servers(cb)
            print("equivalent" if same else "DIFFERENT")
            return 0 if same else 3
        elif a.cmd == "caddy-record":
            if a.action == "write":
                caddy_record_save(a.dir, caddy_record_build(a.dir, a.caddyfile, a.site))
            else:
                caddy_record_intent(a.dir, a.direction or "", a.status or "")
        elif a.cmd == "caddy-classify":
            verdict, direction, detail = caddy_classify(a.dir, a.container_ino)
            print(f"{verdict}|{direction}|{detail}")
            return {"NO_RECORD": 0, "CONSISTENT": 0, "INTERRUPTED": 10, "UNRELATED_EDIT": 11, "RECORD_INVALID": 12}[verdict]
        elif a.cmd == "acceptance-check":
            good, why = acceptance_check(a.dir)
            print(("valid: " if good else "invalid: ") + why)
            return 0 if good else 3
        elif a.cmd == "caddy-route-audit":
            env: dict = {}
            with open(a.env_file, encoding="utf-8") as fh:
                for line in fh:
                    k, sep, v = line.rstrip("\n").partition("=")
                    if sep and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", k):
                        env[k] = v
            managed = {_host_only(env[k]) for k in ("API_HOST", "WEB_HOST", "PORTAL_HOST") if env.get(k)}
            expected, unresolved = [], []
            for f in sorted(glob.glob(os.path.join(a.sites_dir, "*.caddy"))):
                with open(f, encoding="utf-8") as fh:
                    hs, bad = site_file_hosts(fh.read(), env)
                expected += hs
                unresolved += [f"{os.path.basename(f)}: {x}" for x in bad]
                if os.path.basename(f) == a.managed_site:
                    managed.update(hs)
            decisions: dict[str, str] = {}
            if a.decisions and os.path.exists(a.decisions):
                with open(a.decisions, encoding="utf-8") as fh:
                    for line in fh:
                        parts = line.split(None, 2)
                        if len(parts) >= 3 and parts[1] == "accept-live" and not parts[0].startswith("#"):
                            decisions[parts[0].lower()] = parts[2].strip()
            rep = caddy_route_audit(load_manifest(a.adapted), managed, decisions, expected, unresolved)
            out(rep)
            return 0 if rep["ok"] else 3
        elif a.cmd == "redact":
            sys.stdout.write(redact(sys.stdin.read()))
    except Refusal as e:
        print(f"REFUSED: {e}", file=sys.stderr)
        return 2
    except (OSError, ValueError, KeyError, IndexError) as e:
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
