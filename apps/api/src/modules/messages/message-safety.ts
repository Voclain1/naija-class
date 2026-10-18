import { randomUUID } from "node:crypto";

import { withTenant, type PrismaClient } from "@school-kit/db";
import { MESSAGE_LIMITS, RateLimitError, ValidationError, type MessageFlagReason, type MessageImageDto, type StagedMessageImageDto } from "@school-kit/types";

import { PRIVATE_FILE_URL_TTL_SECONDS, sniffPrivateFile } from "../../common/storage/private-file.js";
import type { StorageService } from "../../common/storage/storage.service.js";
import { hasSafeguardingWord } from "./safeguarding-words.js";

// Phase 9 / CP8.2 — images and flags on private messages
// (docs/modules/phase-9.md §17.10).
//
// IMAGES. Up to 3 a message, JPG/PNG/WebP, 5 MB each, typed by their bytes.
// The writer uploads each one on its own (a phone's upload is one file a
// request, and Vercel caps a proxied body at 4.5 MB), which STAGES it; the
// message then names the staged ids. Only the uploader can attach their own
// staged image, and only once. Read through 5-minute links by whoever can see
// the conversation.
//
// FLAGS. A parent's report, a member of staff's flag, or a safeguarding word
// opens the conversation to the owner and admins, and keeps it past the
// two-year deletion until an admin clears it.

type Db = PrismaClient;
type ImageExt = "jpg" | "png" | "webp";

export interface Uploader {
  kind: "GUARDIAN" | "STAFF";
  id: string;
}

/** Staged images an uploader may hold at once (not yet sent). */
const MAX_STAGED = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Stores one image, staged until a message names it. */
export async function stageMessageImage(storage: StorageService, schoolId: string, uploader: Uploader, buffer: Buffer | undefined): Promise<StagedMessageImageDto> {
  if (!buffer || buffer.length === 0) throw new ValidationError("INVALID_UPLOAD", "Choose a photo to attach.");
  if (buffer.length > MESSAGE_LIMITS.imageBytes) throw new ValidationError("FILE_TOO_LARGE", "The photo is larger than 5 MB.");
  const kind = sniffPrivateFile(buffer);
  if (!kind || kind.ext === "pdf") throw new ValidationError("INVALID_FILE_TYPE", "Attach a photo (JPEG, PNG or WebP).");
  const ext = kind.ext as ImageExt;

  const staged = await withTenant(schoolId, (db) =>
    db.messageImage.count({
      where: { schoolId, uploaderKind: uploader.kind, uploaderId: uploader.id, messageId: null, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    }),
  );
  if (staged >= MAX_STAGED) throw new RateLimitError("MESSAGE_IMAGE_LIMIT", "Send or remove the photos you have already added first.");

  const id = randomUUID();
  await storage.put(schoolId, { kind: "message-image", imageId: id, ext }, buffer, kind.mime);
  try {
    await withTenant(schoolId, (db) =>
      db.messageImage.create({ data: { id, schoolId, uploaderKind: uploader.kind, uploaderId: uploader.id, ext, sizeBytes: buffer.length } }),
    );
  } catch (err) {
    await storage.delete(schoolId, { kind: "message-image", imageId: id, ext }).catch(() => undefined);
    throw err;
  }
  return { id };
}

/** Attaches the writer's own staged images to their new message, in one go or not at all. */
export async function attachMessageImages(db: Db, schoolId: string, uploader: Uploader, imageIds: string[], messageId: string): Promise<void> {
  const ids = [...new Set(imageIds)];
  if (ids.length === 0) return;
  const done = await db.messageImage.updateMany({
    where: { id: { in: ids }, schoolId, uploaderKind: uploader.kind, uploaderId: uploader.id, messageId: null },
    data: { messageId },
  });
  if (done.count !== ids.length) throw new ValidationError("INVALID_IMAGE", "A photo could not be attached. Add it again.");
}

/** Five-minute links for each message's images, in the order they were added. */
export async function messageImageLinks(db: Db, storage: StorageService, schoolId: string, messageIds: string[]): Promise<Map<string, MessageImageDto[]>> {
  const out = new Map<string, MessageImageDto[]>();
  if (messageIds.length === 0) return out;
  const rows = await db.messageImage.findMany({
    where: { schoolId, messageId: { in: messageIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, messageId: true, ext: true },
  });
  for (const r of rows) {
    const url = await storage.signUrl(schoolId, { kind: "message-image", imageId: r.id, ext: r.ext as ImageExt }, PRIVATE_FILE_URL_TTL_SECONDS);
    const list = out.get(r.messageId!) ?? [];
    list.push({ id: r.id, url });
    out.set(r.messageId!, list);
  }
  return out;
}

/** Deletes the stored files of these images (rows go with their message, or separately). */
export async function deleteImageFiles(storage: StorageService, schoolId: string, rows: { id: string; ext: string }[]): Promise<void> {
  for (const r of rows) {
    await storage.delete(schoolId, { kind: "message-image", imageId: r.id, ext: r.ext as ImageExt }).catch(() => undefined);
  }
}

/** Flags a conversation for the owner and admins. True when it was not flagged before. */
export async function flagThread(
  db: Db,
  schoolId: string,
  threadId: string,
  flag: { reason: MessageFlagReason; note: string | null; byKind: "GUARDIAN" | "STAFF" | "SYSTEM"; byId: string | null },
): Promise<boolean> {
  const done = await db.messageThread.updateMany({
    where: { id: threadId, schoolId, flaggedAt: null },
    data: { flaggedAt: new Date(), flagReason: flag.reason, flagNote: flag.note, flaggedByKind: flag.byKind, flaggedById: flag.byId },
  });
  return done.count === 1;
}

/**
 * Marks a new message that contains a safeguarding word, and flags its
 * conversation. Never blocks it. True when the conversation was newly flagged.
 */
export async function checkSafeguarding(db: Db, schoolId: string, threadId: string, messageId: string, body: string): Promise<boolean> {
  if (!hasSafeguardingWord(body)) return false;
  await db.message.update({ where: { id: messageId }, data: { safeguardingMatch: true } });
  return flagThread(db, schoolId, threadId, { reason: "SAFEGUARDING_WORDS", note: null, byKind: "SYSTEM", byId: null });
}
