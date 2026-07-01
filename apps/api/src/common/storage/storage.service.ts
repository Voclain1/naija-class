import { Inject, Injectable } from "@nestjs/common";

import type {
  StorageBody,
  StorageDriver,
  StorageObjectKey,
  StoragePath,
} from "./storage.types";

export const STORAGE_DRIVER_TOKEN = "STORAGE_DRIVER";

// Thin pass-through service that holds the registered driver. The driver
// is registered once by StorageModule's factory (filesystem in dev,
// R2 in prod). Consumers depend on StorageService, never on a driver
// directly — this is the seam that keeps imports.service.ts free of
// "if-driver-equals" branches.
@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_DRIVER_TOKEN) private readonly driver: StorageDriver,
  ) {}

  get driverKind(): StorageDriver["kind"] {
    return this.driver.kind;
  }

  put(
    schoolId: string,
    key: StorageObjectKey,
    body: StorageBody,
    contentType: string,
    contentDisposition?: string,
  ): Promise<StoragePath> {
    return this.driver.put(schoolId, key, body, contentType, contentDisposition);
  }

  get(schoolId: string, key: StorageObjectKey): Promise<Buffer> {
    return this.driver.get(schoolId, key);
  }

  signUrl(
    schoolId: string,
    key: StorageObjectKey,
    ttlSeconds: number,
  ): Promise<string> {
    return this.driver.signUrl(schoolId, key, ttlSeconds);
  }

  delete(schoolId: string, key: StorageObjectKey): Promise<void> {
    return this.driver.delete(schoolId, key);
  }

  deleteImportPrefix(schoolId: string, jobId: string): Promise<void> {
    return this.driver.deleteImportPrefix(schoolId, jobId);
  }
}
