import { Global, Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";

import {
  FilesystemStorageDriver,
  defaultFilesystemRoot,
} from "./filesystem-storage.driver";
import { R2StorageDriver } from "./r2-storage.driver";
import {
  STORAGE_DRIVER_TOKEN,
  StorageService,
} from "./storage.service";
import type { StorageDriver } from "./storage.types";

// Global storage module. Decides which driver to instantiate from env.
//
//   STORAGE_DRIVER=filesystem   (default) — local disk under .storage/
//   STORAGE_DRIVER=r2                     — Cloudflare R2 (requires
//                                            R2_ACCOUNT_ID, R2_BUCKET,
//                                            R2_ACCESS_KEY_ID,
//                                            R2_SECRET_ACCESS_KEY)
//
// Dev defaults to filesystem so onboarding has no R2 prerequisite — the
// path layout is identical to R2 (see storage.utils.ts/pathFor), so
// switching env vars at deploy time is the only difference between dev
// and prod. STORAGE_FILESYSTEM_ROOT overrides the dev location for
// tests that need an isolated directory.

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STORAGE_DRIVER_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorageDriver => {
        const kind = (config.get<string>("STORAGE_DRIVER") ?? "filesystem").toLowerCase();
        const logger = new Logger("StorageModule");

        if (kind === "r2") {
          const accountId = config.get<string>("R2_ACCOUNT_ID");
          const accessKeyId = config.get<string>("R2_ACCESS_KEY_ID");
          const secretAccessKey = config.get<string>("R2_SECRET_ACCESS_KEY");
          const bucket = config.get<string>("R2_BUCKET");
          if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
            throw new Error(
              "STORAGE_DRIVER=r2 requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET",
            );
          }
          logger.log(`Using R2 storage driver (bucket=${bucket})`);
          return new R2StorageDriver({ accountId, accessKeyId, secretAccessKey, bucket });
        }

        if (kind === "filesystem") {
          const root = config.get<string>("STORAGE_FILESYSTEM_ROOT") ?? defaultFilesystemRoot();
          logger.log(`Using filesystem storage driver (root=${root})`);
          return new FilesystemStorageDriver(root);
        }

        throw new Error(
          `STORAGE_DRIVER must be "filesystem" or "r2" (got "${kind}")`,
        );
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
