#!/usr/bin/env python3
"""Validate and compare the backup settings file (backup.env) without ever printing a value.

  python3 backup_env.py validate FILE
  python3 backup_env.py compare RUNNING_FILE GITHUB_FILE

Output is key NAMES and verdicts only: no values, no lengths, no hashes. Exit status is
non-zero on any BLOCK, so a caller (guard script, CI job) cannot mistake a bad file for a
good one. Provider rules are for Cloudflare R2, the production object store.
"""
import re
import sys

REQUIRED = [
    "BACKUP_BUCKET",
    "WALG_S3_PREFIX",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_ENDPOINT",
    "AWS_REGION",
    "HEALTHCHECK_PING_URL",
]
SECRET_KEYS = {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "HEALTHCHECK_PING_URL"}
LINE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$")


def parse(path):
    """Returns (values, problems). Problems are (key-or-line-label, text) pairs."""
    values, problems = {}, []
    with open(path, newline="") as handle:
        raw = handle.read()
    if raw.strip() == "":
        return values, [("file", "is empty")]
    for number, line in enumerate(raw.split("\n"), 1):
        if line.endswith("\r"):
            problems.append((f"line {number}", "has a CRLF line ending"))
            line = line.rstrip("\r")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = LINE.match(line)
        if not match:
            problems.append((f"line {number}", "is not KEY=VALUE (content withheld)"))
            continue
        key, value = match.groups()
        if key in values:
            problems.append((key, "is duplicated"))
        values[key] = value
        if value != value.strip():
            problems.append((key, "has leading or trailing whitespace"))
        if value[:1] in "\"'" or value[-1:] in "\"'":
            problems.append((key, "is quoted (docker run --env-file keeps the quotes literally)"))
    return values, problems


def validate(values, problems):
    blocks = list(problems)
    for key in REQUIRED:
        if key not in values:
            blocks.append((key, "is missing"))
        elif values[key].strip() == "":
            blocks.append((key, "is empty"))
    v = values
    if v.get("AWS_ENDPOINT") and not re.fullmatch(r"https://[0-9a-f]{32}(\.(eu|fedramp))?\.r2\.cloudflarestorage\.com", v["AWS_ENDPOINT"]):
        blocks.append(("AWS_ENDPOINT", "is not a Cloudflare R2 S3 endpoint (https://<account>.r2.cloudflarestorage.com)"))
    if v.get("AWS_REGION") and v["AWS_REGION"] != "auto":
        blocks.append(("AWS_REGION", "must be 'auto' for Cloudflare R2"))
    if v.get("WALG_S3_PREFIX") and v.get("BACKUP_BUCKET"):
        match = re.fullmatch(r"s3://([^/]+)(/.*)?", v["WALG_S3_PREFIX"])
        if not match:
            blocks.append(("WALG_S3_PREFIX", "is not s3://<bucket>[/path]"))
        elif match.group(1) != v["BACKUP_BUCKET"]:
            blocks.append(("WALG_S3_PREFIX", "names a different bucket from BACKUP_BUCKET"))
    if v.get("BACKUP_BUCKET") and not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", v["BACKUP_BUCKET"]):
        blocks.append(("BACKUP_BUCKET", "is not a valid bucket name"))
    if v.get("HEALTHCHECK_PING_URL") and not re.fullmatch(r"https://hc-ping\.com/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", v["HEALTHCHECK_PING_URL"]):
        blocks.append(("HEALTHCHECK_PING_URL", "is not https://hc-ping.com/<uuid>"))
    for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        if v.get(key) and re.search(r"\s", v[key]):
            blocks.append((key, "contains whitespace"))
    return blocks


def cmd_validate(path):
    values, problems = parse(path)
    blocks = validate(values, problems)
    for key in REQUIRED:
        if not any(b[0] == key for b in blocks):
            print(f"PASS {key} present, non-empty, well-formed")
    for key, text in blocks:
        print(f"BLOCK {key} {text}")
    extra = sorted(set(values) - set(REQUIRED))
    if extra:
        print("INFO other keys present: " + ", ".join(extra))
    return 1 if blocks else 0


def cmd_compare(running_path, github_path):
    running, running_problems = parse(running_path)
    github, github_problems = parse(github_path)
    status = 0
    for label, problems in (("running backup.env", running_problems), ("GitHub BACKUP_ENV_FILE", github_problems)):
        for key, text in problems:
            print(f"BLOCK {label}: {key} {text}")
            status = 1
    for label, values, problems in (("running backup.env", running, running_problems), ("GitHub BACKUP_ENV_FILE", github, github_problems)):
        for key, text in validate(values, []):
            if not any(p[0] == key for p in problems):
                print(f"BLOCK {label}: {key} {text}")
                status = 1
    only_running = sorted(set(running) - set(github))
    only_github = sorted(set(github) - set(running))
    different = sorted(k for k in set(running) & set(github) if running[k] != github[k])
    identical = len(set(running) & set(github)) - len(different)
    print(f"EVIDENCE keys: running={len(running)} github={len(github)} identical={identical}")
    for label, keys in (("only on the VPS", only_running), ("only in GitHub", only_github), ("different value", different)):
        print(f"EVIDENCE {label}: " + (", ".join(keys) if keys else "none"))
    if only_running or only_github or different:
        print("BLOCK unresolved discrepancy between the running file and the GitHub secret")
        if only_github:
            print("BLOCK keys that exist only in GitHub would be lost if the secret were replaced from the VPS: merge them by hand first")
        status = 1
    else:
        print("PASS GitHub secret and running backup.env are identical")
    return status


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "validate":
        sys.exit(cmd_validate(sys.argv[2]))
    if len(sys.argv) == 4 and sys.argv[1] == "compare":
        sys.exit(cmd_compare(sys.argv[2], sys.argv[3]))
    sys.exit("usage: backup_env.py validate FILE | compare RUNNING GITHUB")
