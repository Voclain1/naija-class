import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve, sep } from "node:path";

import { Controller, Get, Inject, Logger, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { DEV_STORAGE_PATH, DEV_STORAGE_SECRET, STORAGE_FS_ROOT, verifyDevStorageSig } from "./dev-storage.util";

// DEV ONLY — registered by StorageModule only when NODE_ENV !== 'production'.
//
// Serves files from the local filesystem storage root so the browser has an
// HTTP URL to download (the filesystem driver's signUrl() points here). Auth is
// the HMAC `sig` + `exp` the driver embedded — this is NOT an open file server:
// a request without a valid, unexpired signature is rejected. Production never
// loads this controller; the R2 driver returns real https:// signed URLs.
//
// Route: GET /api/v1/dev-storage/<canonical-path>?exp=<ms>&sig=<hmac>
// where <canonical-path> is the storage key (schools/<id>/report-cards/...pdf).
@Controller(DEV_STORAGE_PATH)
export class DevStorageController {
  private readonly logger = new Logger(DevStorageController.name);

  constructor(
    @Inject(STORAGE_FS_ROOT) private readonly root: string,
    @Inject(DEV_STORAGE_SECRET) private readonly secret: string,
  ) {}

  @Get("*")
  async serve(
    @Req() req: Request,
    @Query("exp") exp: string,
    @Query("sig") sig: string,
    @Res() res: Response,
  ): Promise<void> {
    // Everything after /dev-storage/ — the canonical storage path. Express puts
    // the wildcard match in params[0].
    const canonical = decodeURIComponent((req.params as Record<string, string>)["0"] ?? "");

    if (!verifyDevStorageSig(canonical, Number(exp), sig ?? "", this.secret)) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Invalid or expired link." } });
      return;
    }

    // Resolve under root; refuse traversal / absolute components.
    if (isAbsolute(canonical) || canonical.includes("..")) {
      res.status(400).json({ error: { code: "BAD_PATH", message: "Bad path." } });
      return;
    }
    const absolute = resolve(this.root, canonical);
    if (!absolute.startsWith(this.root + sep)) {
      res.status(400).json({ error: { code: "BAD_PATH", message: "Bad path." } });
      return;
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(absolute);
    } catch {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "File not found." } });
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${basename(canonical)}"`);
    res.send(bytes);
  }
}
