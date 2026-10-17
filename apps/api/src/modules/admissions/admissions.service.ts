import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  admissionStatusValues,
  NotFoundError,
  type AdmissionDetailDto,
  type AdmissionDocumentSlot,
  type AdmissionListDto,
  type AdmissionListItemDto,
  type AdmissionStatus,
  type ListAdmissionsInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { PRIVATE_FILE_URL_TTL_SECONDS } from "../../common/storage/private-file.js";
import { StorageService } from "../../common/storage/storage.service.js";
import type { PrivateFileExt } from "../../common/storage/storage.types.js";

// Phase 9 / CP7.1 — the school's Admissions list (docs/modules/phase-9.md
// §16.8). Applicants are NOT students: they live here, by status and class,
// until the school admits them (CP7.2). Owner, admin and Admissions officers.
// Documents are read through a 5-minute signed link (F1), and each read is
// audited.

const ADMISSION_ROLES = ["owner", "admin", "admission_officer"] as const;

interface RequestContext {
  ipAddress: string | null;
}

const LIST_SELECT = {
  id: true,
  reference: true,
  childFirstName: true,
  childLastName: true,
  dateOfBirth: true,
  gender: true,
  guardianFirstName: true,
  guardianLastName: true,
  guardianPhone: true,
  status: true,
  createdAt: true,
  classLevel: { select: { name: true } },
  _count: { select: { documents: true } },
} as const;

@Injectable()
export class AdmissionsService {
  constructor(private readonly storage: StorageService) {}

  async list(authCtx: AuthContext, query: ListAdmissionsInput): Promise<AdmissionListDto> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const status: AdmissionStatus = query.status ?? "SUBMITTED";
      const rows = await db.admissionApplication.findMany({
        where: { schoolId: authCtx.schoolId, status, ...(query.classLevelId ? { classLevelId: query.classLevelId } : {}) },
        orderBy: { createdAt: status === "SUBMITTED" ? "asc" : "desc" },
        take: 500,
        select: LIST_SELECT,
      });
      const grouped = await db.admissionApplication.groupBy({ by: ["status"], where: { schoolId: authCtx.schoolId }, _count: { _all: true } });
      const counts = Object.fromEntries(admissionStatusValues.map((s) => [s, 0])) as Record<AdmissionStatus, number>;
      for (const g of grouped) counts[g.status] = g._count._all;
      return { items: rows.map(listItem), counts };
    });
  }

  async get(authCtx: AuthContext, id: string): Promise<AdmissionDetailDto> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.admissionApplication.findFirst({
        where: { id, schoolId: authCtx.schoolId },
        select: {
          ...LIST_SELECT,
          guardianRelationship: true,
          guardianEmail: true,
          answers: true,
          consentAt: true,
          statusChangedAt: true,
          documents: { orderBy: { slot: "asc" }, select: { id: true, slot: true, label: true, ext: true, sizeBytes: true } },
        },
      });
      if (!row) throw new NotFoundError("Application not found.");
      const answers = (row.answers ?? {}) as {
        fields?: { label: string; value: string }[];
        questions?: { label: string; answer: string }[];
        secondGuardian?: { firstName: string; lastName: string; relationship: string; phone: string; email?: string };
      };
      const sg = answers.secondGuardian;
      return {
        ...listItem(row),
        childFirstName: row.childFirstName,
        childLastName: row.childLastName,
        guardian: { firstName: row.guardianFirstName, lastName: row.guardianLastName, relationship: row.guardianRelationship, phone: row.guardianPhone, email: row.guardianEmail },
        details: [
          ...(answers.fields ?? []).map((f) => ({ label: f.label, value: f.value })),
          ...(answers.questions ?? []).map((q) => ({ label: q.label, value: q.answer })),
        ],
        secondGuardian: sg ? { name: `${sg.firstName} ${sg.lastName}`.trim(), relationship: sg.relationship, phone: sg.phone, email: sg.email ?? null } : null,
        documentFiles: row.documents.map((d) => ({ ...d, slot: d.slot as AdmissionDocumentSlot })),
        consentAt: row.consentAt,
        statusChangedAt: row.statusChangedAt,
      };
    });
  }

  /** A 5-minute link to one document. Audited. */
  async documentUrl(authCtx: AuthContext, applicationId: string, documentId: string, req: RequestContext): Promise<{ url: string }> {
    await assertUserActiveAndHasOneOf(authCtx, ADMISSION_ROLES);
    const doc = await withTenant(authCtx.schoolId, async (db) => {
      const d = await db.admissionDocument.findFirst({ where: { id: documentId, applicationId, schoolId: authCtx.schoolId }, select: { id: true, ext: true } });
      if (!d) throw new NotFoundError("Document not found.");
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "admission.document.read",
          entityType: "admission_application",
          entityId: applicationId,
          ipAddress: req.ipAddress,
          metadata: { documentId },
        },
      });
      return d;
    });
    const url = await this.storage.signUrl(
      authCtx.schoolId,
      { kind: "admission-document", documentId: doc.id, ext: doc.ext as PrivateFileExt },
      PRIVATE_FILE_URL_TTL_SECONDS,
    );
    return { url };
  }
}

/** New applications, for the dashboard's "Needs you today". */
export async function newAdmissionCount(db: { admissionApplication: { count: (args: { where: { status: "SUBMITTED" } }) => Promise<number> } }): Promise<number> {
  return db.admissionApplication.count({ where: { status: "SUBMITTED" } });
}

function listItem(r: {
  id: string;
  reference: string;
  childFirstName: string;
  childLastName: string;
  dateOfBirth: Date;
  gender: "MALE" | "FEMALE" | "OTHER";
  guardianFirstName: string;
  guardianLastName: string;
  guardianPhone: string;
  status: AdmissionStatus;
  createdAt: Date;
  classLevel: { name: string };
  _count: { documents: number };
}): AdmissionListItemDto {
  return {
    id: r.id,
    reference: r.reference,
    childName: `${r.childFirstName} ${r.childLastName}`.trim(),
    dateOfBirth: r.dateOfBirth.toISOString().slice(0, 10),
    gender: r.gender,
    classLevel: r.classLevel.name,
    guardianName: `${r.guardianFirstName} ${r.guardianLastName}`.trim(),
    guardianPhone: r.guardianPhone,
    status: r.status,
    submittedAt: r.createdAt,
    documents: r._count.documents,
  };
}
