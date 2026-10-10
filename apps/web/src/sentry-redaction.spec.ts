import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { redactValue } from "@school-kit/types";

// The staff web app's Sentry configs use the ONE shared redactor
// (packages/types/src/redact.ts) since 2026-10-10. Before, the web app kept a
// copy whose key list stopped at the credential keys, so a browser event could
// carry a student's name, date of birth or medical notes. These pin both
// halves: the shared rules mask student PII, and neither config forks again.
describe("web Sentry redaction", () => {
  it("masks student PII keys, not only credentials", () => {
    expect(
      redactValue({ firstName: "Adaeze", dateOfBirth: "2013-05-10", medicalNotes: "asthma", password: "x", grade: "B" }),
    ).toEqual({
      firstName: "[REDACTED]",
      dateOfBirth: "[REDACTED]",
      medicalNotes: "[REDACTED]",
      password: "[REDACTED]",
      grade: "B",
    });
  });

  it.each(["sentry.client.config.ts", "sentry.server.config.ts"])(
    "%s imports the shared redactor",
    (file) => {
      const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
      expect(source).toMatch(/import \{ redactString, redactValue \} from "@school-kit\/types";/);
    },
  );
});
