import { Body, Controller, Get, HttpCode, Ip, Param, Post, UploadedFiles, UseFilters, UseInterceptors } from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import {
  admissionDocumentSlotValues,
  submitAdmissionSchema,
  ValidationError,
  type AdmissionDocumentSlot,
  type AdmissionTrackDto,
  type PublicAdmissionFormDto,
  type SubmitAdmissionInput,
  type SubmitAdmissionResultDto,
} from "@school-kit/types";

import { PRIVATE_FILE_MAX_BYTES } from "../../common/storage/private-file.js";
import { UploadErrorFilter } from "../../common/upload-error.filter.js";
import { ZodValidationPipe } from "../../common/zod-validation.pipe.js";
import { ADMISSION_UPLOAD_FIELDS, AdmissionsPublicService } from "./admissions-public.service.js";

// Phase 9 / CP7.1 — the PUBLIC admission form (docs/modules/phase-9.md §16,
// §16.8). No guard: pre-login by design, like the result checker. Per-address
// limits here; the honeypot, the per-email limit and the school's own form are
// enforced in the service.
@Controller("apply")
export class AdmissionsPublicController {
  constructor(private readonly service: AdmissionsPublicService) {}

  @Get(":slug")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  form(@Param("slug") slug: string): Promise<PublicAdmissionFormDto> {
    return this.service.form(slug);
  }

  // multipart/form-data: "data" (the JSON answers) and one file per document
  // slot (photo, birthCertificate, lastReport, custom1..3), 10 MB each.
  @Post(":slug")
  @HttpCode(201)
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      Object.values(ADMISSION_UPLOAD_FIELDS).map((name) => ({ name, maxCount: 1 })),
      { limits: { fileSize: PRIVATE_FILE_MAX_BYTES, files: admissionDocumentSlotValues.length, fields: 2 } },
    ),
  )
  @UseFilters(new UploadErrorFilter("10 MB"))
  submit(
    @Param("slug") slug: string,
    @UploadedFiles() uploaded: Record<string, Express.Multer.File[] | undefined> | undefined,
    @Body("data") data: string | undefined,
    @Ip() ip: string,
  ): Promise<SubmitAdmissionResultDto> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data ?? "");
    } catch {
      throw new ValidationError("INVALID_APPLICATION", "Send the application as JSON in a 'data' field.");
    }
    const input = new ZodValidationPipe(submitAdmissionSchema).transform(parsed, { type: "body" }) as SubmitAdmissionInput;
    const files: Partial<Record<AdmissionDocumentSlot, Buffer>> = {};
    for (const slot of admissionDocumentSlotValues) {
      const file = uploaded?.[ADMISSION_UPLOAD_FIELDS[slot]]?.[0];
      if (file) files[slot] = file.buffer;
    }
    return this.service.submit(slug, input, files, { ipAddress: ip });
  }

  @Get(":slug/track/:token")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  track(@Param("slug") slug: string, @Param("token") token: string): Promise<AdmissionTrackDto> {
    return this.service.track(slug, token);
  }
}
