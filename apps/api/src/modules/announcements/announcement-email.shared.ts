import { createHmac, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "@school-kit/db";
import { sickbayDayOf } from "@school-kit/types";

import { portalBaseUrl } from "../../common/portal-url.js";
import { resolveResultPinKey } from "../result-checker/result-pin-key.js";

// Phase 9 / CP8.3 — email broadcasts for announcements
// (docs/modules/phase-9.md §17.11, owner's answers 2026-10-18).
//
// Who: every guardian linked to a child enrolled this term (in the class, for
// a CLASS announcement), as the push reaches, LESS anyone whose portal access
// the school switched off. Every address on file counts, including one that
// came from an admission application (Admit writes it onto the guardian).
// Each address once.

type Db = PrismaClient;

export interface FamilyAddress {
  guardianId: string;
  /** Lower-cased; null when the school holds none. */
  email: string | null;
}

/** The families an announcement to this audience reaches, with their addresses. */
export async function familyAddresses(db: Db, schoolId: string, a: { audience: string; classArmId: string | null }): Promise<FamilyAddress[]> {
  if (a.audience === "STAFF") return [];
  const enrollments = await db.enrollment.findMany({
    where: { schoolId, term: { isCurrent: true }, ...(a.audience === "CLASS" && a.classArmId ? { classArmId: a.classArmId } : {}) },
    select: { studentId: true },
  });
  const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
  if (studentIds.length === 0) return [];
  const guardians = await db.guardian.findMany({
    where: { schoolId, portalDisabledAt: null, students: { some: { studentId: { in: studentIds } } } },
    select: { id: true, email: true },
  });
  return guardians.map((g) => ({ guardianId: g.id, email: g.email?.trim() ? g.email.trim().toLowerCase() : null }));
}

/** Addresses this school must not send announcement email to: unsubscribed, bounced or complained. */
export async function blockedAddresses(db: Db, schoolId: string, emails: string[]): Promise<Map<string, "UNSUBSCRIBED" | "SUPPRESSED">> {
  const out = new Map<string, "UNSUBSCRIBED" | "SUPPRESSED">();
  if (emails.length === 0) return out;
  const rows = await db.emailSuppression.findMany({ where: { schoolId, email: { in: emails } }, select: { email: true, scope: true } });
  for (const r of rows) {
    if (r.scope === "ALL") out.set(r.email, "SUPPRESSED");
    else if (!out.has(r.email)) out.set(r.email, "UNSUBSCRIBED");
  }
  return out;
}

// ─── The unsubscribe link ──────────────────────────────────────────────────
//
// An HMAC of (school, address) under the result-checker key, with a label of
// its own (as admission tracking does). No table holds it: the link works for
// as long as the key does, and cannot be forged for another school or address.

const LABEL = "email-unsubscribe:v1:";

export function unsubscribeToken(schoolId: string, email: string, key: string = resolveResultPinKey()): string {
  return createHmac("sha256", key).update(`${LABEL}${schoolId}:${email.toLowerCase()}`).digest("hex");
}

export function unsubscribeTokenValid(schoolId: string, email: string, token: string): boolean {
  const want = Buffer.from(unsubscribeToken(schoolId, email), "hex");
  const got = Buffer.from(token, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The portal page a parent opens, and the one-click address mail apps POST to. */
export function unsubscribeLinks(schoolId: string, slug: string, email: string): { page: string; oneClick: string } {
  const qs = new URLSearchParams({ s: slug, e: email, t: unsubscribeToken(schoolId, email) }).toString();
  return { page: `${portalBaseUrl()}/email/unsubscribe?${qs}`, oneClick: `${portalBaseUrl()}/api/email/unsubscribe?${qs}` };
}

// ─── The email ─────────────────────────────────────────────────────────────

export function announcementEmailHtml(p: { schoolName: string; title: string; body: string; unsubscribeUrl: string }): string {
  const paragraphs = escapeHtml(p.body)
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 12px">${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#13262E;max-width:560px">`,
    `<p style="margin:0 0 4px;color:#5B6B72">${escapeHtml(p.schoolName)}</p>`,
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(p.title)}</h1>`,
    paragraphs,
    `<p style="margin:20px 0 12px"><a href="${portalBaseUrl()}/announcements">Read it in the parent portal</a></p>`,
    `<p style="margin:24px 0 0;font-size:12px;color:#5B6B72">You get this because you are a parent at ${escapeHtml(p.schoolName)}. `,
    `<a href="${escapeHtml(p.unsubscribeUrl)}">Stop announcement emails</a>. Messages from the school and receipts still arrive.</p>`,
    `</div>`,
  ].join("");
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** The Lagos calendar day, as a DATE. */
export function lagosToday(now = new Date()): Date {
  return new Date(`${sickbayDayOf(now)}T00:00:00.000Z`);
}
