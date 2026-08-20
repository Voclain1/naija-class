import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

import {
  PROMPTS,
  STUDENT_LIST_EXTRACTION_SCHEMA,
  STUDENT_LIST_EXTRACTION_SYSTEM,
  renderStudentListExtractionPrompt,
} from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import {
  InternalError,
  SCAN_ACCEPTED_MIME_TYPES,
  SCAN_MAX_FILE_SIZE_BYTES,
  ValidationError,
  studentImportRowSchema,
  studentListExtractionSchema,
  type CommitScanInput,
  type ReviewedStudentRow,
  type ScanExtractionResponse,
  type StudentImportRow,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service";
import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { commitStudentRow } from "../imports/workers/commit-students.row";
import { readImageDimensions, sniffImageMimeType } from "./image-dimensions";

// ---------------------------------------------------------------------------
// StudentScanService — Smart Student Import.
//
// An admin photographs a class register; the model transcribes it; the admin
// reviews and edits every row; only then does anything reach `students`.
// Full design in docs/modules/smart-student-import.md.
//
// ---------------------------------------------------------------------------
// D3 — THE IMAGE IS NEVER PERSISTED. THIS IS THE POINT OF THE DESIGN.
//
// A photographed register is one artifact holding forty children's names,
// dates of birth, class placement and parent phone numbers, immediately
// readable with no database access, no query and no tenant context. Every
// other PII store in this product is a row behind RLS. This is a JPEG.
//
// So the buffer arrives in memory (Multer memoryStorage), is base64'd, is
// sent, and is dropped when the request ends. There is deliberately NO:
//   * StorageObjectKey kind for it — nothing can put it in R2 or on the
//     filesystem driver, because no key shape exists to address it;
//   * BullMQ job — a queued job needs the bytes to outlive the request,
//     which is a persistence decision wearing a scheduling costume;
//   * Redis buffer — considered as option A' and NOT taken; it would be a
//     copy at rest for up to 15 minutes, and calling that "never stored"
//     would be a lie told to ourselves first;
//   * retry-with-the-same-image path — a failed extraction means the admin
//     re-photographs, which costs ten seconds.
//
// The cost of all that is that extraction is SYNCHRONOUS and can take 30-60s
// on a full page. That is accepted, bounded (D5 caps a scan at one page) and
// communicable (the client shows progress). If you are here to make this
// async, you are proposing to persist the image; read D3 first, then get
// sign-off, because it was decided explicitly and not by default.
// ---------------------------------------------------------------------------
//
// D4 — nothing here writes a Student outside commitScan(), which takes the
// rows the ADMIN sends back after reviewing them, not the rows the model
// produced. extractFromImage() creates an ImportJob and returns a draft; it
// touches no student record at all.

// Multer's file shape, narrowed to what this service reads. Mirrors the
// equivalent interface in imports.service.ts rather than importing it —
// that one is private to that module and this one needs `mimetype`, which
// the CSV path deliberately ignores.
interface UploadImage {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

const AUDIT = {
  scan: "student.scan",
  commit: "student.scan.commit",
} as const;

@Injectable()
export class StudentScanService {
  private readonly logger = new Logger(StudentScanService.name);

  constructor(private readonly ai: AiGenerationService) {}

  // True when a scan could actually be attempted. The UI uses this to hide
  // the camera affordance rather than letting an admin photograph a register
  // and only then discover AI is switched off for their school.
  isConfigured(): boolean {
    return this.ai.isConfigured();
  }

  // -------------------------------------------------------------------------
  // EXTRACT — POST /student-scan
  //
  // Gating note (D2): this method contains NO gate of its own. Every
  // safeguard — the AI_ENABLED platform switch, School.aiEnabled, the
  // missing-key fail-soft, the monthly token budget and the per-user daily
  // call cap — lives inside AiGenerationService.generate() and applies here
  // by construction. Adding a second gate would create a place for the two
  // to disagree.
  // -------------------------------------------------------------------------
  async extractFromImage(
    authCtx: AuthContext,
    file: UploadImage,
    reqCtx: RequestContext,
  ): Promise<ScanExtractionResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const image = this.validateImage(file);

    // Known arms are school STRUCTURE, not student data — safe to send, and
    // it is what stops the model inventing its own formatting for a class
    // name the resolver will then reject.
    const knownClassArms = await withTenant(authCtx.schoolId, async (db) => {
      const arms = await db.classArm.findMany({
        where: { isActive: true },
        select: { name: true },
        orderBy: { name: "asc" },
      });
      return arms.map((a) => a.name);
    });

    const result = await this.ai.generate({
      schoolId: authCtx.schoolId,
      userId: authCtx.userId,
      prompt: PROMPTS.STUDENT_LIST_EXTRACTION,
      system: STUDENT_LIST_EXTRACTION_SYSTEM,
      userContent: renderStudentListExtractionPrompt({ knownClassArms }),
      jsonSchema: STUDENT_LIST_EXTRACTION_SCHEMA,
      images: [image],
    });

    // The model's output is a trust boundary, not just a type. Structured
    // outputs make a shape violation unlikely, not impossible, and a
    // malformed extraction must fail here rather than halfway through
    // building a preview the admin would then be editing.
    let parsed;
    try {
      parsed = studentListExtractionSchema.parse(JSON.parse(result.text));
    } catch (e) {
      this.logger.warn(
        `student-scan: unparseable extraction for school ${authCtx.schoolId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      throw new InternalError(
        "The scan could not be read. Try again, or photograph the page in better light.",
      );
    }

    const jobId = randomUUID();

    await withTenant(authCtx.schoolId, async (db) => {
      await db.importJob.create({
        data: {
          id: jobId,
          schoolId: authCtx.schoolId,
          type: "STUDENTS_SCAN",
          // READY, not PENDING: a CSV job is PENDING while it waits for the
          // admin to map columns, and a scan has no mapping step — the model
          // already mapped the fields. The next thing that happens to this
          // row is a commit.
          status: "READY",
          // Empty string: there is no source object, because the image was
          // never persisted (D3). See the column's schema comment for why
          // this is not nullable.
          sourceFileUrl: "",
          totalRows: parsed.rows.length,
          previewSnapshot: {
            good: parsed.rows.map((row, i) => ({ rowNumber: i + 1, parsedRow: row })),
            bad: [],
          },
          createdBy: authCtx.userId,
        },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.scan,
          entityType: "import_job",
          entityId: jobId,
          ipAddress: reqCtx.ipAddress,
          // NO extracted values here, and no filename either. The audit log
          // is queryable by a wider set of readers than the import preview
          // is, and this row's whole subject is a page of children's PII —
          // recording row counts is enough to answer "who scanned what,
          // when" without copying the payload into a second place.
          metadata: {
            rowCount: parsed.rows.length,
            unreadableRowCount: parsed.rows.filter((r) => r.unreadableFields.length > 0).length,
            widthPx: image.widthPx,
            heightPx: image.heightPx,
            mimeType: image.mediaType,
          },
        },
      });
    });

    return {
      jobId,
      rows: parsed.rows,
      pageNotes: parsed.pageNotes,
      knownClassArms,
    };
  }

  // -------------------------------------------------------------------------
  // COMMIT — POST /student-scan/:jobId/commit
  //
  // D4's human gate. The rows in `dto` are what the ADMIN confirmed, not what
  // the model produced: by now they have corrected names, filled cells the
  // model flagged unreadable and deleted rows that were not students.
  //
  // Everything is re-validated from scratch against studentImportRowSchema —
  // the same schema the CSV path uses. The extraction is a draft, and a draft
  // the client has been editing is not a source of truth. Nothing carried
  // over from extractFromImage() is trusted here except the job's identity.
  // -------------------------------------------------------------------------
  async commitScan(
    authCtx: AuthContext,
    jobId: string,
    dto: CommitScanInput,
    reqCtx: RequestContext,
  ): Promise<{ committedRows: number; notEnrolledRows: number; failedRows: { rowNumber: number; field: string; message: string }[] }> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const job = await withTenant(authCtx.schoolId, (db) =>
      db.importJob.findUnique({
        where: { id: jobId },
        select: { id: true, type: true, status: true },
      }),
    );
    if (!job) throw new ValidationError("JOB_NOT_FOUND", "Scan not found.");
    if (job.type !== "STUDENTS_SCAN") {
      // A CSV job reaching this endpoint would bypass its own mapping and
      // validation steps entirely. Refuse rather than silently accepting
      // client-supplied rows against a job that has a source file.
      throw new ValidationError("WRONG_JOB_TYPE", "That import is not a scan.");
    }
    if (job.status !== "READY") {
      throw new ValidationError(
        "JOB_NOT_READY",
        job.status === "COMPLETED"
          ? "This scan has already been committed."
          : `This scan cannot be committed while it is ${job.status}.`,
      );
    }

    // Duplicate admission numbers WITHIN the submitted set. The database's
    // (school_id, admission_number) unique constraint would catch these one
    // at a time as the loop reached them, but that reports the second row as
    // a race against a row this same request created moments earlier, which
    // is a confusing thing to read. Catch it up front and name both rows.
    const seen = new Map<string, number>();
    const duplicates: { rowNumber: number; field: string; message: string }[] = [];
    for (const row of dto.rows) {
      const key = row.admissionNumber.trim().toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) {
        duplicates.push({
          rowNumber: row.rowNumber,
          field: "admissionNumber",
          message: `Admission number "${row.admissionNumber}" is already used by row ${first} of this scan.`,
        });
      } else {
        seen.set(key, row.rowNumber);
      }
    }
    if (duplicates.length > 0) {
      throw new ValidationError(
        "DUPLICATE_ADMISSION_NUMBERS",
        "Two or more rows share an admission number. Fix them before importing.",
        { rows: duplicates },
      );
    }

    // Resolve the enrollment target ONCE, before the row loop — identical to
    // commit.handler.ts. academicYearId is derived from the term server-side
    // and never accepted from input, because Enrollment.academicYearId must
    // stay consistent with term.academicYearId.
    let enrollmentTarget: { termId: string; academicYearId: string } | undefined;
    if (dto.targetTermId) {
      const term = await withTenant(authCtx.schoolId, (db) =>
        db.term.findUnique({
          where: { id: dto.targetTermId },
          select: { id: true, academicYearId: true },
        }),
      );
      if (!term) {
        throw new ValidationError(
          "TARGET_TERM_NOT_FOUND",
          "The selected term no longer exists. Pick another.",
        );
      }
      enrollmentTarget = { termId: term.id, academicYearId: term.academicYearId };
    }

    let committedRows = 0;
    let notEnrolledRows = 0;
    const failedRows: { rowNumber: number; field: string; message: string }[] = [];

    // Per-row transaction, matching commit.handler.ts: one bad row must not
    // roll back the thirty-nine good ones. An admin who has just reviewed a
    // whole page should not lose all of it to a single duplicate admission
    // number.
    for (const reviewed of dto.rows) {
      const parsed = studentImportRowSchema.safeParse(toImportRow(reviewed));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        failedRows.push({
          rowNumber: reviewed.rowNumber,
          field: issue?.path.length ? String(issue.path[0]) : "(row)",
          message: issue?.message ?? "Row failed validation.",
        });
        continue;
      }

      const row: StudentImportRow = parsed.data;
      if (row.classArm === undefined || enrollmentTarget === undefined) notEnrolledRows += 1;

      try {
        await withTenant(authCtx.schoolId, (db) =>
          // aiExtracted = true. The row was confirmed by a human, so this is
          // provenance, not a trust downgrade — see the column's comment.
          commitStudentRow(row, authCtx.schoolId, db, enrollmentTarget, true),
        );
        committedRows += 1;
      } catch (e) {
        failedRows.push({
          rowNumber: reviewed.rowNumber,
          field: describeFailureField(e),
          message: describeFailure(e, row.admissionNumber),
        });
      }
    }

    await withTenant(authCtx.schoolId, async (db) => {
      await db.importJob.update({
        where: { id: jobId },
        data: {
          status: "COMPLETED",
          validRows: dto.rows.length - failedRows.length,
          invalidRows: failedRows.length,
          committedRows,
          notEnrolledRows,
          completedAt: new Date(),
        },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.commit,
          entityType: "import_job",
          entityId: jobId,
          ipAddress: reqCtx.ipAddress,
          // Counts only — no names, no admission numbers. Same reasoning as
          // the scan audit row above.
          metadata: {
            submittedRows: dto.rows.length,
            committedRows,
            failedRows: failedRows.length,
            notEnrolledRows,
            enrolled: enrollmentTarget !== undefined,
          },
        },
      });
    });

    return { committedRows, notEnrolledRows, failedRows };
  }

  // -------------------------------------------------------------------------
  // Upload validation.
  //
  // Runs BEFORE any DB read and before any AI spend: a 12 MB file or a PDF
  // should cost the school nothing.
  // -------------------------------------------------------------------------
  private validateImage(file: UploadImage) {
    if (!file || file.size === 0) {
      throw new ValidationError("INVALID_IMAGE", "No image uploaded, or the file was empty.");
    }
    if (file.size > SCAN_MAX_FILE_SIZE_BYTES) {
      throw new ValidationError(
        "IMAGE_TOO_LARGE",
        `That photo is larger than ${Math.floor(SCAN_MAX_FILE_SIZE_BYTES / (1024 * 1024))} MB. Most phone cameras produce a smaller file; check whether yours is set to maximum resolution.`,
      );
    }

    // Sniff the actual bytes rather than trusting the multipart
    // Content-Type. The header is client-supplied and this payload goes to a
    // third party — a file that CLAIMS to be a JPEG and is not should be
    // rejected here, not produce a confusing 400 from the Anthropic API. It
    // also closes the declared-JPEG/actual-PNG case, where we would
    // otherwise send the wrong media_type for bytes that are perfectly
    // valid.
    const sniffed = sniffImageMimeType(file.buffer);
    if (!sniffed || !(SCAN_ACCEPTED_MIME_TYPES as readonly string[]).includes(sniffed)) {
      throw new ValidationError(
        "UNSUPPORTED_IMAGE_TYPE",
        "That file is not a JPEG, PNG or WebP photo. Take a photo with your phone's camera and upload that.",
      );
    }

    // Null dimensions => charge the model's full visual-token cap, which
    // estimateImageTokens does when it gets a non-positive value. Over-
    // reserving is the safe direction; the settle step reconciles it down to
    // the true count moments later.
    const dims = readImageDimensions(file.buffer, sniffed);
    if (!dims) {
      this.logger.warn(
        `student-scan: could not decode ${sniffed} dimensions; reserving at the model's full visual-token cap`,
      );
    }

    return {
      mediaType: sniffed,
      base64: file.buffer.toString("base64"),
      widthPx: dims?.widthPx ?? 0,
      heightPx: dims?.heightPx ?? 0,
    };
  }
}

// Maps a reviewed row onto the CSV import row shape. The two differ in
// exactly two ways, both deliberate: `rowNumber` is transport metadata rather
// than student data, and dateOfBirth arrives as a YYYY-MM-DD string that has
// to become a calendar Date.
//
// Date.UTC, not `new Date(string)`: the column is @db.Date and CLAUDE.md's
// convention exists precisely to keep a school's "born 2015-03-04" from
// becoming 2015-03-03 in some timezone. Parsing the parts explicitly makes
// that impossible rather than merely unlikely.
function toImportRow(reviewed: ReviewedStudentRow): Record<string, unknown> {
  const [y, m, d] = reviewed.dateOfBirth.split("-").map(Number);
  return {
    admissionNumber: reviewed.admissionNumber,
    firstName: reviewed.firstName,
    lastName: reviewed.lastName,
    dateOfBirth: new Date(Date.UTC(y, m - 1, d)),
    gender: reviewed.gender,
    ...(reviewed.middleName ? { middleName: reviewed.middleName } : {}),
    ...(reviewed.classArm ? { classArm: reviewed.classArm } : {}),
  };
}

// CommitRowError (from the CSV commit path) carries the field it failed on;
// anything else is a database-level failure whose only unambiguous cause on
// `students` is the (school_id, admission_number) unique constraint.
function describeFailureField(e: unknown): string {
  if (e && typeof e === "object" && "field" in e && typeof e.field === "string") return e.field;
  return "admissionNumber";
}

function describeFailure(e: unknown, admissionNumber: string): string {
  if (e && typeof e === "object" && "message" in e && "field" in e && typeof e.message === "string") {
    return e.message;
  }
  if (e && typeof e === "object" && "code" in e && e.code === "P2002") {
    return `Admission number "${admissionNumber}" already exists in this school's roster.`;
  }
  return "Could not save this row.";
}
