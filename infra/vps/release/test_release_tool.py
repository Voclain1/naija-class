"""Unit tests for release_tool.py. Run: python3 -m unittest infra/vps/release/test_release_tool.py -v
Every decision the release system makes about a manifest, a migration or a secret is a pure
function here, so it is tested with fixtures and no Docker, database or network."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import release_tool as t  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
def jl(path):
    with open(path) as fh:
        return json.load(fh)


D = lambda c: "ghcr.io/voclain1/school-kit-api@sha256:" + c * 64  # noqa: E731


def mig(name, cls="additive", destructive=False, checksum=None):
    return {"name": name, "checksum": checksum or (name[-1].encode().hex() * 32)[:64], "class": cls, "destructive": destructive, "findings": []}


def manifest(sha="a" * 40, images="1", migrations=None, pg=18):
    migs = migrations if migrations is not None else [mig("20270101000000_a")]
    return {
        "schema": 1, "release_id": f"20261127T120000Z-{sha[:12]}", "git_sha": sha, "built_at": "2026-11-27T12:00:00Z", "pg_major": pg,
        "images": {s: f"ghcr.io/voclain1/school-kit-{s}@sha256:{images * 64}" for s in ("api", "render-worker", "web", "portal")},
        "migrate_image": "ghcr.io/voclain1/school-kit-migrate@sha256:" + "c" * 64,
        "migrations": migs, "schema_head": migs[-1]["name"] if migs else "", "migrations_digest": t.migrations_digest(migs),
    }


def applied(*migs, finished=True, rolled_back=False):
    return [{"name": m["name"], "checksum": m["checksum"], "finished": finished, "rolled_back": rolled_back} for m in migs]


class Classification(unittest.TestCase):
    def c(self, sql):
        return t.classify_sql(sql)

    def test_new_table_and_nullable_column_are_additive(self):
        self.assertEqual(self.c('CREATE TABLE "x" (id text primary key);\nALTER TABLE "y" ADD COLUMN "n" TEXT;')["class"], "additive")

    def test_constraints_on_a_table_created_in_the_same_migration_are_additive(self):
        r = self.c('CREATE TABLE "x" (id text, a text);\nALTER TABLE "x" ADD CONSTRAINT "u" UNIQUE (a);\nCREATE UNIQUE INDEX "i" ON "x"(a);\nINSERT INTO "x" VALUES (\'1\',\'2\');')
        self.assertEqual(r["class"], "additive", r)

    def test_unique_index_on_an_existing_table_is_breaking(self):
        self.assertEqual(self.c('CREATE UNIQUE INDEX "i" ON "payments"("ref");')["class"], "breaking")

    def test_constraint_on_a_column_added_in_the_same_migration_is_additive(self):
        r = self.c('ALTER TABLE "p" ADD COLUMN "k" TEXT;\nALTER TABLE "p" ADD CONSTRAINT "fk" FOREIGN KEY ("k") REFERENCES "q"("id");')
        self.assertEqual(r["class"], "additive", r)

    def test_check_constraint_on_an_existing_column_is_breaking(self):
        self.assertEqual(self.c('ALTER TABLE "p" ADD CONSTRAINT "c" CHECK (amount > 0);')["class"], "breaking")

    def test_destructive_statements(self):
        for sql in ("DROP TABLE x;", "ALTER TABLE x DROP COLUMN y;", "TRUNCATE x;", "DROP TYPE t;"):
            r = self.c(sql)
            self.assertEqual((r["class"], r["destructive"]), ("breaking", True), sql)

    def test_delete_is_data_and_destructive(self):
        r = self.c("DELETE FROM x WHERE a = 1;")
        self.assertEqual((r["class"], r["destructive"]), ("data", True))

    def test_backfill_is_data_not_breaking(self):
        r = self.c("UPDATE payments SET legacy = '' WHERE legacy IS NULL;")
        self.assertEqual((r["class"], r["destructive"]), ("data", False))

    def test_not_null_without_default_is_breaking_but_with_default_is_not(self):
        self.assertEqual(self.c('ALTER TABLE p ADD COLUMN "z" TEXT NOT NULL;')["class"], "breaking")
        self.assertEqual(self.c("ALTER TABLE p ADD COLUMN \"z\" TEXT NOT NULL DEFAULT 'x';")["class"], "additive")

    def test_drop_function_is_breaking(self):
        self.assertEqual(self.c("DROP FUNCTION IF EXISTS f(text);")["class"], "breaking")

    def test_comments_and_function_bodies_are_not_statements(self):
        sql = "-- DROP TABLE nothing\n/* TRUNCATE x */\nCREATE FUNCTION f() RETURNS void AS $$ BEGIN DELETE FROM t; END $$ LANGUAGE plpgsql;"
        self.assertEqual(self.c(sql)["class"], "additive")

    def test_the_repositorys_real_migrations_classify_and_include_known_destructive_ones(self):
        folder = os.path.join(REPO, "packages", "db", "prisma", "migrations")
        migs = t.scan_migrations(folder)
        self.assertGreater(len(migs), 150)
        self.assertTrue(all(m["class"] in t.CLASSES for m in migs))
        self.assertTrue(any(m["destructive"] for m in migs))

    def test_checksum_is_prismas_sha256_of_the_file(self):
        with tempfile.NamedTemporaryFile("wb", delete=False) as f:
            f.write(b"SELECT 1;\n")
        self.addCleanup(os.unlink, f.name)
        import hashlib
        self.assertEqual(t.prisma_checksum(f.name), hashlib.sha256(b"SELECT 1;\n").hexdigest())


class ManifestValidation(unittest.TestCase):
    def test_valid(self):
        t.validate_manifest(manifest())

    def refuse(self, m, text):
        with self.assertRaises(t.Refusal) as cm:
            t.validate_manifest(m)
        self.assertIn(text, str(cm.exception))

    def test_tags_are_refused(self):
        m = manifest(); m["images"]["api"] = "ghcr.io/voclain1/school-kit-api:latest"
        self.refuse(m, "immutable")

    def test_foreign_registry_is_refused(self):
        m = manifest(); m["images"]["api"] = "evil.example/voclain1/school-kit-api@sha256:" + "d" * 64
        self.refuse(m, "allow-list")

    def test_prefix_lookalike_is_refused(self):
        m = manifest(); m["images"]["api"] = "ghcr.io/voclain1-evil/school-kit-api@sha256:" + "d" * 64
        self.refuse(m, "allow-list")

    def test_missing_required_service_and_unknown_key(self):
        m = manifest(); del m["images"]["portal"]; self.refuse(m, "images.portal")
        m = manifest(); m["extra"] = 1; self.refuse(m, "unexpected")
        m = manifest(); m["images"]["shell"] = D("e"); self.refuse(m, "unknown service")

    def test_bad_sha_id_and_digest_mismatch(self):
        m = manifest(); m["git_sha"] = "xyz"; self.refuse(m, "40-hex")
        m = manifest(); m["release_id"] = "20261127T120000Z-000000000000"; self.refuse(m, "release_id")
        m = manifest(); m["migrations_digest"] = "0" * 64; self.refuse(m, "migrations_digest")
        m = manifest(); m["schema_head"] = "nope"; self.refuse(m, "schema_head")

    def test_out_of_order_and_duplicate_migrations(self):
        m = manifest(migrations=[mig("20270201000000_b"), mig("20270101000000_a")]); self.refuse(m, "ascending")
        m = manifest(migrations=[mig("20270101000000_a"), mig("20270101000000_a")]); self.refuse(m, "duplicate")

    def test_optional_cbt_is_allowed(self):
        m = manifest(); m["images"]["cbt"] = D("f"); m["images"]["cbt"] = "ghcr.io/voclain1/school-kit-cbt@sha256:" + "f" * 64
        t.validate_manifest(m)


class Planning(unittest.TestCase):
    A = mig("20270101000000_a")
    B = mig("20270201000000_b", "additive")

    def plan(self, m, cur, rows):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "applied.tsv")
            with open(p, "w") as fh:
                for r in rows:
                    fh.write(f"{r['name']}\t{r['checksum']}\t{'t' if r['finished'] else 'f'}\t{'t' if r['rolled_back'] else 'f'}\n")
            return t.make_plan(m, cur, t.parse_applied(p))

    def test_noop(self):
        m = manifest()
        p = self.plan(m, m, applied(self.A))
        self.assertEqual((p["class"], p["services_changed"], p["blockers"]), ("NOOP", [], []))

    def test_app_only_lists_exactly_the_changed_services_in_apply_order(self):
        cur = manifest(images="1"); new = manifest(sha="b" * 40, images="2")
        new["images"]["web"] = cur["images"]["web"]
        p = self.plan(new, cur, applied(self.A))
        self.assertEqual(p["class"], "APP_ONLY")
        self.assertEqual(p["services_changed"], ["render-worker", "api", "portal"])
        self.assertFalse(p["needs_approval"] or p["needs_maintenance"])

    def test_additive_schema_needs_approval_but_not_maintenance(self):
        cur = manifest(); new = manifest(sha="b" * 40, images="2", migrations=[self.A, self.B])
        p = self.plan(new, cur, applied(self.A))
        self.assertEqual((p["class"], p["needs_approval"], p["needs_maintenance"], p["rollback_allowed_after"]), ("SCHEMA", True, False, True))
        self.assertEqual([x["name"] for x in p["pending"]], [self.B["name"]])

    def test_data_and_breaking_need_maintenance_and_breaking_forbids_rollback(self):
        cur = manifest()
        p = self.plan(manifest(sha="b" * 40, migrations=[self.A, mig("20270201000000_b", "data")]), cur, applied(self.A))
        self.assertTrue(p["needs_maintenance"]); self.assertTrue(p["rollback_allowed_after"])
        p = self.plan(manifest(sha="b" * 40, migrations=[self.A, mig("20270201000000_b", "breaking", True)]), cur, applied(self.A))
        self.assertTrue(p["needs_maintenance"]); self.assertFalse(p["rollback_allowed_after"]); self.assertTrue(p["destructive"])

    def test_modified_applied_migration_blocks(self):
        cur = manifest(); changed = dict(self.A, checksum="9" * 64)
        p = self.plan(manifest(sha="b" * 40, migrations=[changed]), cur, applied(self.A))
        self.assertTrue(any(b.startswith("CHECKSUM_MISMATCH") for b in p["blockers"]))

    def test_unresolved_failed_migration_blocks(self):
        cur = manifest()
        p = self.plan(manifest(sha="b" * 40, migrations=[self.A, self.B]), cur, applied(self.A) + applied(self.B, finished=False))
        self.assertTrue(any(b.startswith("UNRESOLVED_MIGRATION") for b in p["blockers"]))

    def test_a_failed_migration_is_unresolved_but_is_not_the_database_being_ahead(self):
        # after a failed migration and a rollback, the OLD release's manifest must not see "database ahead"
        cur = manifest()
        p = self.plan(manifest(), cur, applied(self.A) + applied(self.B, finished=False))
        self.assertEqual([b for b in p["blockers"] if b.startswith("DATABASE_AHEAD")], [])
        self.assertTrue(any(b.startswith("UNRESOLVED_MIGRATION") for b in p["blockers"]))

    def test_rolled_back_attempt_does_not_count_as_applied(self):
        cur = manifest()
        p = self.plan(manifest(sha="b" * 40, migrations=[self.A, self.B]), cur, applied(self.A) + applied(self.B, finished=False, rolled_back=True))
        self.assertEqual(p["blockers"], [])
        self.assertEqual([x["name"] for x in p["pending"]], [self.B["name"]])

    def test_out_of_order_migration_blocks(self):
        early = mig("20260101000000_early")
        cur = manifest(migrations=[self.A])
        p = self.plan(manifest(sha="b" * 40, migrations=[early, self.A]), cur, applied(self.A))
        self.assertTrue(any(b.startswith("OUT_OF_ORDER") for b in p["blockers"]))

    def test_database_ahead_of_an_older_release_is_a_rollback_like_when_safe_and_blocked_when_breaking(self):
        cur = manifest(sha="b" * 40, migrations=[self.A, self.B])
        old = manifest(migrations=[self.A])
        p = self.plan(old, cur, applied(self.A, self.B))
        self.assertEqual((p["kind"], p["blockers"], p["needs_approval"]), ("ROLLBACK_LIKE", [], True))
        cur2 = manifest(sha="b" * 40, migrations=[self.A, mig("20270201000000_b", "breaking")])
        p = self.plan(old, cur2, applied(self.A, mig("20270201000000_b", "breaking")))
        self.assertTrue(any(b.startswith("DATABASE_AHEAD") for b in p["blockers"]))

    def test_no_baseline_blocks(self):
        p = self.plan(manifest(), None, applied(self.A))
        self.assertIn("NO_BASELINE", p["blockers"])

    def test_bad_applied_rows_are_refused_not_guessed(self):
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write("only\ttwo\n")
        self.addCleanup(os.unlink, f.name)
        with self.assertRaises(t.Refusal):
            t.parse_applied(f.name)


class RollbackCheck(unittest.TestCase):
    A = mig("20270101000000_a"); ADD = mig("20270201000000_b", "additive"); BRK = mig("20270301000000_c", "breaking", True)

    def check(self, cur_migs, target_migs, rows):
        return t.rollback_check(manifest(sha="b" * 40, migrations=cur_migs), manifest(migrations=target_migs), applied(*rows))

    def test_nothing_extra_is_allowed(self):
        self.assertTrue(self.check([self.A], [self.A], [self.A])["allowed"])

    def test_additive_extra_is_allowed(self):
        r = self.check([self.A, self.ADD], [self.A], [self.A, self.ADD])
        self.assertTrue(r["allowed"]); self.assertEqual(r["extras"], [self.ADD["name"]])

    def test_breaking_extra_forbids_rollback(self):
        r = self.check([self.A, self.BRK], [self.A], [self.A, self.BRK])
        self.assertFalse(r["allowed"]); self.assertIn("breaking", r["reasons"][0])

    def test_unknown_extra_forbids_rollback(self):
        r = self.check([self.A], [self.A], [self.A, self.ADD])
        self.assertFalse(r["allowed"])

    def test_a_failed_attempt_is_not_an_extra(self):
        cur = manifest(sha="b" * 40, migrations=[self.A, self.BRK])
        rows = applied(self.A) + applied(self.BRK, finished=False)
        self.assertTrue(t.rollback_check(cur, manifest(migrations=[self.A]), rows)["allowed"])


class Redaction(unittest.TestCase):
    def test_masks_secrets_and_personal_data(self):
        samples = {
            "postgresql://app_user:Sup3rS3cret@db:5432/x": "Sup3rS3cret",
            "redis://:p@ss@h": None,
            "key sk_live_abcdefgh12345678": "abcdefgh12345678",
            "pk_test_abcdefgh12345678": "abcdefgh12345678",
            "whsec_ABCDEFGH12345678": "ABCDEFGH12345678",
            "re_ABCDEFGHIJKL1234": "ABCDEFGHIJKL1234",
            "ghp_ABCDEFGHIJKLMNOPQRSTUVWX": "ABCDEFGHIJKLMNOPQRSTUVWX",
            "Authorization: Bearer abcdefghijklmnop12345": "abcdefghijklmnop12345",
            "x-paystack-signature: 0123456789abcdef": "0123456789abcdef",
            "RESEND_API_KEY=re_abcdef0123456789": "re_abcdef0123456789",
            "BETTER_AUTH_SECRET=hunter2hunter2": "hunter2hunter2",
            "contact parent@example.com now": "parent@example.com",
            "call 08031234567": "08031234567",
            "call +2348031234567": "2348031234567",
            "token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.abcdefghijkl": "eyJzdWIiOiIxMjM0",
        }
        for text, secret in samples.items():
            out = t.redact(text)
            if secret:
                self.assertNotIn(secret, out, text)

    def test_does_not_destroy_ordinary_text(self):
        s = "api is healthy on release 20261127T120000Z-aabbccddeeff (3 services)"
        self.assertEqual(t.redact(s), s)

    def test_event_values_are_redacted_on_write(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "h.jsonl")
            t.append_event(p, "x", t.kv_pairs(["note=postgresql://u:pw123456@h/db", "n=3", "ok=true"]))
            line = jl(p)
            self.assertNotIn("pw123456", json.dumps(line))
            self.assertEqual((line["n"], line["ok"]), (3, True))


class CaddyMaintenance(unittest.TestCase):
    def test_a_truncated_or_altered_candidate_is_caught_even_when_it_is_a_valid_caddyfile(self):
        text = open(os.path.join(REPO, "infra", "vps", "Caddyfile")).read()
        good = t.maintenance_caddyfile(text, "# M")
        t.verify_maintenance_caddyfile(text, good, "# M")
        for bad in (good[:40], good[: len(good) // 2], good.replace("503", "200"), text, ""):
            with self.assertRaises(t.Refusal):
                t.verify_maintenance_caddyfile(text, bad, "# M")

    def test_site_candidate_verification(self):
        site = '*.{$D} {\n\ttls {\n\t\tdns cloudflare {env.T}\n\t}\n\thandle {\n\t\treverse_proxy p:3000\n\t}\n}\n'
        good = t.maintenance_site(site)
        t.verify_maintenance_site(site, good)
        with self.assertRaises(t.Refusal):
            t.verify_maintenance_site(site, good[:20])

    def test_only_the_three_school_kit_blocks_change(self):
        text = open(os.path.join(REPO, "infra", "vps", "Caddyfile")).read()
        out = t.maintenance_caddyfile(text, "# M")
        self.assertEqual(out.count("# M\n"), 3)
        self.assertEqual(out.count("respond"), 3)
        self.assertIn("import sites/*.caddy", out)
        self.assertIn("(upstream) {", out)
        self.assertIn("trusted_proxies", out)

    def test_refuses_when_a_block_is_missing(self):
        with self.assertRaises(t.Refusal):
            t.maintenance_caddyfile("{$API_HOST} {\n\trespond ok\n}\n", "# M")

    def test_site_keeps_its_tls_block_and_drops_handlers(self):
        site = '*.{$SCHOOL_ADDRESS_DOMAIN} {\n\ttls {\n\t\tdns cloudflare {env.CLOUDFLARE_API_TOKEN}\n\t}\n\thandle {\n\t\treverse_proxy portal:3000\n\t}\n}\n'
        out = t.maintenance_site(site)
        self.assertIn("dns cloudflare {env.CLOUDFLARE_API_TOKEN}", out)
        self.assertNotIn("reverse_proxy", out)
        self.assertIn("503", out)


class JournalAndState(unittest.TestCase):
    def test_state_is_atomic_and_merges(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "state.json")
            self.assertEqual(t.main(["state", "set", "--file", p, "phase=STAGED", "mutated=false"]), 0)
            self.assertEqual(t.main(["state", "set", "--file", p, "phase=SWITCHED"]), 0)
            s = jl(p)
            self.assertEqual((s["phase"], s["mutated"]), ("SWITCHED", False))
            self.assertEqual(oct(os.stat(p).st_mode & 0o777), "0o600")
            self.assertEqual([x for x in os.listdir(d) if x.startswith(".tmp")], [])

    def test_bad_key_is_refused(self):
        self.assertEqual(t.main(["state", "set", "--file", "/nonexistent/x", "Bad Key=1"]), 2)

    def test_cli_build_manifest_end_to_end(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "migrations", "20270101000000_a"))
            open(os.path.join(d, "migrations", "20270101000000_a", "migration.sql"), "w").write("CREATE TABLE t (id int);")
            out = os.path.join(d, "m.json")
            args = ["build-manifest", "--git-sha", "a" * 40, "--pg-major", "18", "--migrations-dir", os.path.join(d, "migrations"),
                    "--migrate-image", "ghcr.io/voclain1/school-kit-migrate@sha256:" + "c" * 64, "--out", out, "--built-at", "2026-11-27T12:00:00Z"]
            for s in ("api", "render-worker", "web", "portal"):
                args += ["--image", f"{s}=ghcr.io/voclain1/school-kit-{s}@sha256:{'d' * 64}"]
            self.assertEqual(t.main(args), 0)
            self.assertEqual(t.main(["validate", out]), 0)
            m = jl(out)
            self.assertEqual(m["release_id"], "20261127T120000Z-" + "a" * 12)
            self.assertEqual(m["migrations"][0]["class"], "additive")
            # a tampered manifest is refused
            m["migrations"][0]["checksum"] = "0" * 64
            with open(out, "w") as fh:
                json.dump(m, fh)
            self.assertEqual(t.main(["validate", out]), 2)


class ScopedBuilds(unittest.TestCase):
    """Unchanged units keep their digest (no restart); changed ones are built; the commit label
    follows the unit, not the release."""
    U = {"api": "aaaa1111aaaa", "render-worker": "bbbb2222bbbb", "web": "cccc3333cccc--", "portal": "dddd4444dddd--", "migrate": "eeee5555eeee"}

    def prev(self):
        m = manifest(sha="a" * 40)
        m["inputs"] = dict(self.U)
        m["provenance"] = {u: "a" * 40 for u in list(self.U)}
        return m

    def test_need_build_lists_only_changed_units(self):
        self.assertEqual(t.need_build(self.prev(), dict(self.U)), [])
        self.assertEqual(t.need_build(self.prev(), dict(self.U, web="ffff0000ffff--")), ["web"])
        self.assertEqual(t.need_build(self.prev(), dict(self.U, api="abababababab", migrate="cdcdcdcdcdcd")), ["api", "migrate"])

    def test_no_previous_release_builds_everything_but_the_optional_exam_app(self):
        inputs = dict(self.U, cbt="a1b2c3d4e5f6--")
        self.assertEqual(t.need_build(None, inputs), ["api", "render-worker", "web", "portal", "migrate"])
        self.assertIn("cbt", t.need_build(None, inputs, with_cbt=True))

    def test_the_exam_app_follows_the_previous_release(self):
        prev = self.prev(); prev["images"]["cbt"] = "ghcr.io/voclain1/school-kit-cbt@sha256:" + "f" * 64; prev["inputs"]["cbt"] = "a1b2c3d4e5f6--"
        self.assertEqual(t.need_build(prev, dict(self.U, cbt="0f0f0f0f0f0f--")), ["cbt"])

    def test_missing_inputs_hash_is_refused_not_guessed(self):
        with self.assertRaises(t.Refusal):
            t.need_build(self.prev(), {"api": "aaaa1111aaaa"})

    def run_build(self, d, built, inputs, previous):
        os.makedirs(os.path.join(d, "mig", "20270101000000_a"), exist_ok=True)
        with open(os.path.join(d, "mig", "20270101000000_a", "migration.sql"), "w") as fh:
            fh.write("CREATE TABLE t (id int);")
        pj = os.path.join(d, "prev.json")
        with open(pj, "w") as fh:
            json.dump(previous, fh)
        out = os.path.join(d, "m.json")
        args = ["build-manifest", "--git-sha", "b" * 40, "--pg-major", "18", "--migrations-dir", os.path.join(d, "mig"), "--out", out,
                "--built-at", "2026-11-28T12:00:00Z", "--previous", pj]
        for u, ref in built.items():
            args += ["--built", f"{u}=ghcr.io/voclain1/school-kit-{u}@sha256:{ref * 64}"]
        for u, h in inputs.items():
            args += ["--input", f"{u}={h}"]
        return t.main(args), out

    def test_manifest_reuses_unchanged_units_with_their_original_commit(self):
        with tempfile.TemporaryDirectory() as d:
            rc, out = self.run_build(d, {"web": "9"}, dict(self.U, web="1234abcd1234--"), self.prev())
            self.assertEqual(rc, 0)
            m = jl(out)
            self.assertEqual(m["images"]["api"], self.prev()["images"]["api"])        # same digest, not restarted
            self.assertEqual(m["images"]["web"], "ghcr.io/voclain1/school-kit-web@sha256:" + "9" * 64)
            self.assertEqual((m["provenance"]["api"], m["provenance"]["web"]), ("a" * 40, "b" * 40))
            self.assertEqual(m["inputs"]["web"], "1234abcd1234--")
            plan = t.make_plan(m, self.prev(), applied(*m["migrations"]))
            self.assertEqual(plan["services_changed"], ["web"])

    def test_a_changed_unit_that_was_not_built_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            rc, _ = self.run_build(d, {}, dict(self.U, web="deadbeefdead--"), self.prev())
            self.assertEqual(rc, 2)

    def test_a_lookalike_unit_name_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.run_build(d, {"postgres": "9"}, dict(self.U), self.prev())[0], 2)


if __name__ == "__main__":
    unittest.main()
