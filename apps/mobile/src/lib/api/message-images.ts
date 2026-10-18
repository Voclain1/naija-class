import type { StagedMessageImageDto } from "@school-kit/types";

import { uploadMultipart } from "./native-upload";

// Phase 9 / CP8.2 — one photo a request, staged until the message names it
// (docs/modules/phase-9.md §17.10). Kept apart from portal.ts and
// staff-messages.ts, which stay free of native imports.

const upload = (path: string, fileUri: string, mimeType: string) =>
  uploadMultipart<StagedMessageImageDto>(path, { fileUri, fieldName: "file", mimeType, parameters: {} });

export const guardianStageMessageImage = (fileUri: string, mimeType: string) => upload("/portal/messages/images", fileUri, mimeType);
export const staffStageMessageImage = (fileUri: string, mimeType: string) => upload("/messages/images", fileUri, mimeType);
