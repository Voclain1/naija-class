import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { importPrefixFor, pathFor } from "./storage.utils";
import type {
  StorageBody,
  StorageDriver,
  StorageDriverKind,
  StorageObjectKey,
  StoragePath,
} from "./storage.types";

// R2StorageDriver — production backing store, S3-compatible.
//
// Path layout identical to FilesystemStorageDriver — same canonical key
// from storage.utils.ts/pathFor() is used as the S3 object key. That
// means switching STORAGE_DRIVER between dev (fs) and prod (r2) requires
// zero application changes; only the driver behind the StorageService
// interface changes.
//
// The signed URL produced by signUrl() lasts for ttlSeconds and is a
// real Cloudflare R2 presigned URL the admin's browser can fetch
// directly. We rely on that for the bad-rows / error-report download
// path in prod; in dev the filesystem driver returns a file:// URL
// instead and the api proxies the bytes through.
//
// Slice 6 only registers this driver when STORAGE_DRIVER=r2 — when not
// configured, the module exports the filesystem driver. That means we
// don't pay the cost of constructing an S3Client (or failing without
// R2 credentials) in dev or CI.

export interface R2StorageConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export class R2StorageDriver implements StorageDriver {
  readonly kind: StorageDriverKind = "r2";
  private readonly client: S3Client;

  constructor(private readonly config: R2StorageConfig) {
    this.client = new S3Client({
      region: "auto", // R2 uses "auto" — region is determined by the bucket
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(
    schoolId: string,
    key: StorageObjectKey,
    body: StorageBody,
    contentType: string,
  ): Promise<StoragePath> {
    const canonical = pathFor(schoolId, key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: canonical,
        Body: body,
        ContentType: contentType,
      }),
    );
    return canonical;
  }

  async get(schoolId: string, key: StorageObjectKey): Promise<Buffer> {
    const canonical = pathFor(schoolId, key);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: canonical,
      }),
    );
    if (!response.Body) {
      throw new Error(`storage: object not found at ${canonical}`);
    }
    // The SDK's Body is a Node Readable stream in this environment.
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async signUrl(
    schoolId: string,
    key: StorageObjectKey,
    ttlSeconds: number,
  ): Promise<string> {
    const canonical = pathFor(schoolId, key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: canonical,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async delete(schoolId: string, key: StorageObjectKey): Promise<void> {
    const canonical = pathFor(schoolId, key);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: canonical,
      }),
    );
  }

  async deleteImportPrefix(schoolId: string, jobId: string): Promise<void> {
    const prefix = importPrefixFor(schoolId, jobId);
    // List then bulk-delete. R2 has no "delete prefix" primitive. We
    // page in batches of 1000 (the AWS SDK's hard ceiling per call);
    // an import directory will hold at most 2 objects in slice 6
    // (source.csv) and 3 in slice 7 (source.csv + error-report.csv),
    // so a single page suffices in realistic use.
    let continuationToken: string | undefined;
    do {
      const listing = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const keys = (listing.Contents ?? [])
        .map((o) => o.Key)
        .filter((k): k is string => typeof k === "string");
      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.config.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          }),
        );
      }
      continuationToken = listing.IsTruncated ? listing.NextContinuationToken : undefined;
    } while (continuationToken);
  }
}
