import { createHash } from "node:crypto";

import type { PrismaClient } from "@school-kit/db";
import { readAdmissionForm, sickbayDayOf, type AdmissionFormConfig } from "@school-kit/types";

// Phase 9 / CP7 — pieces the admissions services share (docs/modules/
// phase-9.md §16, §16.8).

type Db = PrismaClient;

/** Who works on applications: owner, admin, and the optional Admissions officer. */
export const ADMISSION_ROLES = ["owner", "admin", "admission_officer"] as const;
/** Who shapes the form and names officers: owner and admin. */
export const ADMISSION_SETTINGS_ROLES = ["owner", "admin"] as const;
/** Closed applications, kept 90 days after closing and then deleted (§16.8 answer 5). */
export const ADMISSION_CLOSED = ["REJECTED", "WITHDRAWN"] as const;
export const ADMISSION_PURGE_DAYS = 90;

export interface EffectiveAdmissionSettings {
  enabled: boolean;
  intro: string | null;
  smsAlerts: boolean;
  notifyEmail: string | null;
  offerLetter: string | null;
  form: AdmissionFormConfig;
  closedClassLevelIds: string[];
}

/**
 * The school's admission settings, or the defaults when it has never saved
 * them. Applications are open by default (owner, §16.8).
 */
export async function loadAdmissionSettings(db: Db, schoolId: string): Promise<EffectiveAdmissionSettings> {
  const row = await db.admissionSettings.findUnique({ where: { schoolId } });
  const closed = Array.isArray(row?.closedClassLevelIds) ? (row!.closedClassLevelIds as unknown[]).filter((v): v is string => typeof v === "string") : [];
  return {
    enabled: row?.enabled ?? true,
    intro: row?.intro ?? null,
    smsAlerts: row?.smsAlerts ?? true,
    notifyEmail: row?.notifyEmail ?? null,
    offerLetter: row?.offerLetter ?? null,
    form: readAdmissionForm(row?.form),
    closedClassLevelIds: closed,
  };
}

/** The class levels open for application, in the school's order. */
export async function openClassLevels(db: Db, schoolId: string, closed: string[]): Promise<{ id: string; name: string }[]> {
  const levels = await db.classLevel.findMany({ where: { schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true, name: true } });
  return levels.filter((l) => !closed.includes(l.id));
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The Lagos calendar day, as a DATE. */
export function lagosToday(): Date {
  return new Date(`${sickbayDayOf(new Date())}T00:00:00.000Z`);
}

/** Text from the public form, made safe to put in an email. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The public form's address for a school. Tomorrow, the school's own subdomain (§16.8). */
export function applyPath(slug: string): string {
  return `/apply/${slug}`;
}
