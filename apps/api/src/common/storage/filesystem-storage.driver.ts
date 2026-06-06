import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { DEV_STORAGE_PATH, computeDevStorageSig } from "./dev-storage.util";
import { importPrefixFor, pathFor } from "./storage.utils";
import type {
  StorageBody,
  StorageDriver,
  StorageDriverKind,
  StorageObjectKey,
  StoragePath,
} from "./storage.types";

// FilesystemStorageDriver — dev-only backing store.
//
// Layout under STORAGE_FILESYSTEM_ROOT (default ./.storage at repo root):
//
//   <root>/schools/<schoolId>/imports/<jobId>/source.csv
//
// IDENTICAL to the R2 layout. Switching STORAGE_DRIVER between dev (fs)
// and prod (r2) must not change application code; the only difference
// admins ever see is signed-URL vs local-served-URL on download paths.
//
// Tenant safety here is the same property R2 paths give us: the driver
// constructs every path via storage.utils.ts/pathFor(), which UUID-
// validates schoolId AND jobId before any I/O. There is no API on this
// driver for "write to a raw path", and a constructed path that
// somehow escapes the root (via traversal or absolute components) is
// rejected by ensureUnderRoot() before the write.

// DEV ONLY. signUrl() returns an HTTP URL pointing at DevStorageController,
// which streams the file from local disk — browsers refuse to load the file://
// URLs this driver used to return. Production uses the R2 driver, whose
// signUrl() returns an https:// presigned URL natively; none of the dev-storage
// machinery runs there.
//
// `signing` is optional: when absent (e.g. a unit test constructing the driver
// with just a root) signUrl() falls back to a file:// URL — harmless because
// tests only assert on the path substring, never open it. The StorageModule
// always wires `signing` in dev so real download links are HTTP.
export interface FilesystemSigning {
  baseUrl: string; // e.g. http://localhost:4000/api/v1
  secret: string;
}

export class FilesystemStorageDriver implements StorageDriver {
  readonly kind: StorageDriverKind = "filesystem";

  constructor(
    private readonly root: string,
    private readonly signing?: FilesystemSigning,
  ) {
    if (!isAbsolute(root)) {
      throw new Error(
        `FilesystemStorageDriver: root must be absolute, got ${root}`,
      );
    }
  }

  async put(
    schoolId: string,
    key: StorageObjectKey,
    body: StorageBody,
    _contentType: string,
  ): Promise<StoragePath> {
    const canonical = pathFor(schoolId, key);
    const absolute = this.absolute(canonical);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, body);
    return canonical;
  }

  async get(schoolId: string, key: StorageObjectKey): Promise<Buffer> {
    const canonical = pathFor(schoolId, key);
    const absolute = this.absolute(canonical);
    return readFile(absolute);
  }

  async signUrl(
    schoolId: string,
    key: StorageObjectKey,
    ttlSeconds: number,
  ): Promise<string> {
    const canonical = pathFor(schoolId, key);
    if (!this.signing) {
      // No signing configured (unit-test construction) — return a file:// URL.
      // Callers in tests only inspect the path; they never fetch it.
      return pathToFileURL(this.absolute(canonical)).toString();
    }
    // HTTP URL the browser CAN load: it routes back to DevStorageController,
    // which verifies the HMAC and streams the bytes. Mirrors an R2 signed URL.
    const exp = Date.now() + ttlSeconds * 1000;
    const sig = computeDevStorageSig(canonical, exp, this.signing.secret);
    return `${this.signing.baseUrl}/${DEV_STORAGE_PATH}/${canonical}?exp=${exp}&sig=${sig}`;
  }

  async delete(schoolId: string, key: StorageObjectKey): Promise<void> {
    const canonical = pathFor(schoolId, key);
    const absolute = this.absolute(canonical);
    // force=true makes "missing" a no-op (idempotent).
    await rm(absolute, { force: true });
  }

  async deleteImportPrefix(schoolId: string, jobId: string): Promise<void> {
    const prefix = importPrefixFor(schoolId, jobId);
    const absolute = this.absolute(prefix);
    await rm(absolute, { force: true, recursive: true });
  }

  // Compute the absolute filesystem path for a canonical key and assert
  // the result is still under `root`. The pathFor() helper already
  // validates the schoolId/jobId UUID components and only ever produces
  // a safe relative path — but ensureUnderRoot is the belt-and-braces
  // check in case a future helper is added that doesn't validate.
  private absolute(canonical: string): string {
    if (isAbsolute(canonical) || canonical.startsWith("..")) {
      throw new Error(`storage: refusing absolute or traversing path '${canonical}'`);
    }
    const absolute = resolve(this.root, canonical);
    if (!absolute.startsWith(this.root + sep) && absolute !== this.root) {
      throw new Error(
        `storage: path '${canonical}' resolves outside root '${this.root}'`,
      );
    }
    return absolute;
  }
}

// Default location for the filesystem driver — under the repo, gitignored
// (the root .gitignore already excludes /.storage). Resolved relative to
// the api's process cwd, which Turborepo sets to apps/api in dev. For
// tests we override this explicitly to a temp dir.
export function defaultFilesystemRoot(): string {
  // join() with absolute cwd produces an absolute path on every platform.
  return join(process.cwd(), ".storage");
}
