import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FilesystemStorageDriver } from "./filesystem-storage.driver";
import { importPrefixFor, pathFor } from "./storage.utils";
import type { StorageObjectKey } from "./storage.types";

// Storage driver path-segregation tests.
//
// The promise the storage layer makes is that no caller can construct a
// path outside the canonical schools/<schoolId>/imports/<jobId>/... layout.
// "no raw-path escape hatch" means:
//   - pathFor() refuses non-UUID schoolId / jobId
//   - the driver interface (put/get/signUrl/delete/deleteImportPrefix)
//     takes (schoolId, key) — there is no putAtRawPath() / getAtRawPath()
//   - even with valid UUIDs, attempts to traverse upward are rejected
//   - dev FilesystemStorageDriver writes ONLY under its configured root,
//     mirroring the bucket-scoped behaviour of R2 in prod
//
// Slice 6 cp1: this is the smoke proof. cp2 adds endpoint specs that
// also exercise this driver in-app.

const VALID_SCHOOL = "11111111-1111-4111-8111-111111111111";
const VALID_JOB = "22222222-2222-4222-8222-222222222222";
const OTHER_SCHOOL = "33333333-3333-4333-8333-333333333333";

describe("storage.utils — pathFor() / importPrefixFor() refuse anything but UUIDs", () => {
  it("returns the canonical layout for valid UUID components", () => {
    const key: StorageObjectKey = { kind: "import-source", jobId: VALID_JOB };
    expect(pathFor(VALID_SCHOOL, key)).toBe(
      `schools/${VALID_SCHOOL}/imports/${VALID_JOB}/source.csv`,
    );
    expect(importPrefixFor(VALID_SCHOOL, VALID_JOB)).toBe(
      `schools/${VALID_SCHOOL}/imports/${VALID_JOB}/`,
    );
  });

  it("refuses a non-UUID schoolId on pathFor()", () => {
    const key: StorageObjectKey = { kind: "import-source", jobId: VALID_JOB };
    expect(() => pathFor("not-a-uuid", key)).toThrow(/schoolId/);
    expect(() => pathFor("../../etc", key)).toThrow(/schoolId/);
    expect(() => pathFor("a/b/c", key)).toThrow(/schoolId/);
    expect(() => pathFor("", key)).toThrow(/schoolId/);
  });

  it("refuses a non-UUID jobId on pathFor()", () => {
    expect(() =>
      pathFor(VALID_SCHOOL, { kind: "import-source", jobId: "../escape" }),
    ).toThrow(/jobId/);
    expect(() =>
      pathFor(VALID_SCHOOL, { kind: "import-source", jobId: "x/y" }),
    ).toThrow(/jobId/);
  });

  it("refuses non-UUID schoolId or jobId on importPrefixFor()", () => {
    expect(() => importPrefixFor("bad", VALID_JOB)).toThrow(/schoolId/);
    expect(() => importPrefixFor(VALID_SCHOOL, "bad")).toThrow(/jobId/);
  });
});

describe("FilesystemStorageDriver — tenant path segregation + no raw-path escape", () => {
  let root: string;
  let driver: FilesystemStorageDriver;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "schoolkit-storage-"));
    driver = new FilesystemStorageDriver(root);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("put + get round-trips a file at the canonical tenant path", async () => {
    const key: StorageObjectKey = { kind: "import-source", jobId: VALID_JOB };
    const body = Buffer.from("name,age\nAda,30\n");
    const returnedPath = await driver.put(VALID_SCHOOL, key, body, "text/csv");
    expect(returnedPath).toBe(`schools/${VALID_SCHOOL}/imports/${VALID_JOB}/source.csv`);

    // Confirm the file landed where the canonical path says it should.
    const absolute = join(root, returnedPath);
    expect(readFileSync(absolute).toString()).toBe("name,age\nAda,30\n");

    const got = await driver.get(VALID_SCHOOL, key);
    expect(got.toString()).toBe("name,age\nAda,30\n");
  });

  it("School B cannot read School A's object by guessing its key", async () => {
    // The key for "School A's job" includes School A's UUID. Asking
    // the driver to get the same key under School B's UUID resolves to
    // a different path on disk; the file doesn't exist there, so it
    // throws ENOENT. The driver never accepts a raw path that crosses
    // tenants; the only way to read School A's bytes is to know the
    // pair (A's schoolId, A's jobId) — exactly what RLS protects in
    // the import_jobs row.
    const key: StorageObjectKey = { kind: "import-source", jobId: VALID_JOB };
    await expect(driver.get(OTHER_SCHOOL, key)).rejects.toThrow();
  });

  it("refuses traversal attempts via non-UUID schoolId", async () => {
    const key: StorageObjectKey = { kind: "import-source", jobId: VALID_JOB };
    await expect(
      driver.put("../etc/passwd", key, Buffer.from("oops"), "text/plain"),
    ).rejects.toThrow(/schoolId/);
    await expect(driver.get("../etc/passwd", key)).rejects.toThrow(/schoolId/);
  });

  it("refuses traversal attempts via non-UUID jobId", async () => {
    const key: StorageObjectKey = {
      kind: "import-source",
      jobId: "../../../escape",
    };
    await expect(
      driver.put(VALID_SCHOOL, key, Buffer.from("oops"), "text/plain"),
    ).rejects.toThrow(/jobId/);
  });

  it("delete is idempotent (no throw on missing file)", async () => {
    const key: StorageObjectKey = {
      kind: "import-source",
      jobId: "44444444-4444-4444-8444-444444444444",
    };
    // never put — delete should succeed silently
    await expect(driver.delete(VALID_SCHOOL, key)).resolves.toBeUndefined();
  });

  it("deleteImportPrefix removes everything under a tenant + jobId, nothing else", async () => {
    const jobToDelete = "55555555-5555-4555-8555-555555555555";
    const jobToKeep = "66666666-6666-4666-8666-666666666666";
    await driver.put(
      VALID_SCHOOL,
      { kind: "import-source", jobId: jobToDelete },
      Buffer.from("to delete"),
      "text/csv",
    );
    await driver.put(
      VALID_SCHOOL,
      { kind: "import-source", jobId: jobToKeep },
      Buffer.from("to keep"),
      "text/csv",
    );

    await driver.deleteImportPrefix(VALID_SCHOOL, jobToDelete);

    // The deleted job is gone:
    await expect(
      driver.get(VALID_SCHOOL, { kind: "import-source", jobId: jobToDelete }),
    ).rejects.toThrow();
    // The unrelated job is untouched:
    const kept = await driver.get(VALID_SCHOOL, {
      kind: "import-source",
      jobId: jobToKeep,
    });
    expect(kept.toString()).toBe("to keep");
  });

  it("constructor refuses a relative root", () => {
    expect(() => new FilesystemStorageDriver("./relative")).toThrow(/absolute/);
  });

  it("signUrl returns a file:// URL for the canonical path", async () => {
    const url = await driver.signUrl(
      VALID_SCHOOL,
      { kind: "import-source", jobId: VALID_JOB },
      60,
    );
    expect(url).toMatch(/^file:\/\//);
    expect(url).toContain(VALID_SCHOOL);
    expect(url).toContain(VALID_JOB);
  });
});

describe("StorageDriver interface surface — no raw-path escape methods", () => {
  it("FilesystemStorageDriver exposes ONLY the StorageDriver interface methods", () => {
    const root = mkdtempSync(join(tmpdir(), "schoolkit-storage-iface-"));
    try {
      const driver = new FilesystemStorageDriver(root);
      // Enumerate methods on the driver's prototype that are not from
      // Object.prototype. If a new public method appears that ISN'T
      // part of the StorageDriver interface — particularly one that
      // takes a raw path — this test will fail and force a review.
      const allowed = new Set([
        "constructor",
        "put",
        "get",
        "signUrl",
        "delete",
        "deleteImportPrefix",
        // Allowed-but-private guarded methods. Adding more without
        // updating this set is a deliberate signal.
        "absolute",
      ]);
      const actual = Object.getOwnPropertyNames(
        Object.getPrototypeOf(driver),
      );
      const unexpected = actual.filter((m) => !allowed.has(m));
      expect(
        unexpected,
        `Unexpected method(s) on FilesystemStorageDriver: ${unexpected.join(", ")}. ` +
          `If you added a method that accepts a raw path, stop — extend StorageObjectKey instead.`,
      ).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
