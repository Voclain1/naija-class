// Regenerates src/help-guide/guide-index.generated.ts from
// docs/onboarding-guide.md (FD-5a). Run after editing the guide:
//
//   pnpm --filter @school-kit/ai help-index
//
// CI fails when the committed index no longer matches the guide
// (apps/web/src/app/help/guide/guide-index.spec.ts), so a guide edit without
// this step cannot merge.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import GithubSlugger from "github-slugger";

import { renderGuideIndexModule, splitGuide } from "../src/help-guide/guide-sections.js";

const guide = fileURLToPath(new URL("../../../docs/onboarding-guide.md", import.meta.url));
const out = fileURLToPath(new URL("../src/help-guide/guide-index.generated.ts", import.meta.url));

const slugger = new GithubSlugger();
const sections = splitGuide(readFileSync(guide, "utf8"), (title) => slugger.slug(title));
writeFileSync(out, renderGuideIndexModule(sections));
console.log(`help guide index: ${sections.length} sections → ${out}`);
