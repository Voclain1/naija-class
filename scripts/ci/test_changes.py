"""python3 -m unittest scripts/ci/test_changes.py -v"""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import changes as c

FULL = dict(static=True, api=True, build=True, e2e=True, tooling=True)


def d(*files):
    return c.decide(list(files))


class Decide(unittest.TestCase):
    def full(self, r):
        for k, v in FULL.items():
            self.assertEqual(r[k], v, k)
        self.assertEqual(r["frontend"], set(c.APPS))

    def test_no_files_or_everything_flag_runs_everything(self):
        self.full(c.decide([])); self.full(c.decide(["docs/x.md"], everything=True))

    def test_docs_only_runs_nothing(self):
        r = d("docs/modules/phase-9.md", "README.md", "docs/reviews/x.md")
        self.assertEqual((r["static"], r["api"], r["build"], r["e2e"], r["tooling"], r["frontend"]), (False,) * 5 + (set(),))

    def test_docs_that_tests_read_run_the_unit_tests(self):
        for f in ("docs/onboarding-guide.md", "CLAUDE.md"):
            r = d(f)
            self.assertTrue(r["api"]); self.assertIn("web", r["frontend"]); self.assertFalse(r["e2e"])

    def test_release_tooling_runs_only_tooling(self):
        r = d("infra/vps/release/release.sh", "scripts/release/poll-release.sh", ".github/workflows/release.yml", "docs/runbooks/automated-release.md")
        self.assertEqual((r["tooling"], r["static"], r["api"], r["e2e"], r["build"]), (True, False, False, False, False))

    def test_api_change_runs_api_e2e_and_static_but_not_frontend_unit_tests(self):
        r = d("apps/api/src/modules/finance/x.ts")
        self.assertEqual((r["api"], r["e2e"], r["static"], r["build"], r["frontend"]), (True, True, True, True, set()))

    def test_one_app_runs_only_that_apps_unit_tests(self):
        self.assertEqual(d("apps/portal/src/x.tsx")["frontend"], {"portal"})
        self.assertEqual(d("apps/web/src/x.tsx", "apps/cbt/src/y.ts")["frontend"], {"web", "cbt"})

    def test_shared_ui_runs_all_frontends(self):
        self.assertEqual(d("packages/ui/src/button.tsx")["frontend"], set(c.APPS))

    def test_mobile_only_is_static_only(self):
        r = d("apps/mobile/src/x.ts")
        self.assertEqual((r["static"], r["api"], r["e2e"], r["build"]), (True, False, False, False))

    def test_global_inputs_run_everything(self):
        for f in ("pnpm-lock.yaml", "package.json", "packages/db/prisma/schema.prisma", "packages/types/src/x.ts", "packages/config/tsconfig.json",
                  "packages/db/prisma/migrations/2027_x/migration.sql", ".github/workflows/ci.yml", "scripts/ci/changes.py", "infra/postgres/init/01.sql"):
            self.full(d(f))

    def test_an_unrecognised_file_runs_everything(self):
        self.full(d("some/new/place/file.ts"))
        self.full(d("docs/x.md", "unknown.bin"))

    def test_a_mix_takes_the_union(self):
        r = d("docs/x.md", "apps/api/src/a.ts", "infra/vps/release/lib.sh")
        self.assertTrue(r["api"] and r["tooling"] and r["e2e"]); self.assertEqual(r["frontend"], set())

    def test_backup_image_only_for_its_inputs(self):
        self.assertTrue(d("infra/vps/postgres/Dockerfile")["backup_image"])
        self.assertFalse(d("apps/api/src/a.ts")["backup_image"])

    def test_render(self):
        lines = c.render(d("apps/portal/src/x.tsx"))
        self.assertIn('frontend_apps=["portal"]', lines); self.assertIn("api=false", lines)


if __name__ == "__main__":
    unittest.main()
