import { Logger } from "@nestjs/common";

import type { PrismaClient } from "@school-kit/db";
import { formatKobo, receiptAmountInWords } from "@school-kit/types";

import type { StorageService } from "../../common/storage/storage.service.js";

// Branded payment receipts (docs/modules/branded-receipts.md).
//
// Two halves, kept apart on purpose:
//   - buildBrandedReceiptHtml — PURE. Takes every fact the receipt shows and
//     returns the document. No database, no clock, no storage: the spec pins
//     its output from fixed input, including the escaping of every school- and
//     parent-supplied string.
//   - issueReceipt — gathers those facts inside the payment's own transaction,
//     draws the receipt number, renders, stores. Called by manual recording,
//     by the Paystack confirmation, and by re-issue.
//
// A receipt is a SNAPSHOT (D2): everything it shows is fixed when it is
// issued — the logo is embedded in the file itself — so a school that changes
// its address next term does not rewrite last term's receipts.

const logger = new Logger("Receipt");

/** Logos above this are left off the receipt rather than bloating every copy (D2). */
export const RECEIPT_LOGO_MAX_BYTES = 300 * 1024;

const DEFAULT_BRAND = "#0E5C43"; // Deep Emerald — the product's own primary

export interface ReceiptData {
  receiptNumber: string;
  paidAt: Date;
  school: {
    name: string;
    motto: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    primaryColor: string | null;
    /** A data: URI, already size-checked, or null. */
    logoDataUri: string | null;
  };
  student: { name: string; admissionNumber: string; className: string | null };
  /** e.g. "First Term 2026/2027". */
  termLabel: string | null;
  amount: number; // kobo
  method: string; // CASH | POS | BANK_TRANSFER | PAYSTACK
  reference: string | null;
  invoice: { totalDue: number; totalPaidAfter: number }; // kobo, server-computed
  /** Staff name for a manual payment; null for an online one. */
  receivedBy: { name: string; role: string | null } | null;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A brand colour is only used when it is a plain #rrggbb — it goes into CSS. */
export function safeBrandColor(value: string | null): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_BRAND;
}

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  POS: "POS",
  BANK_TRANSFER: "Bank transfer",
  PAYSTACK: "Online (Paystack)",
};

/** "22 September 2026, 10:42" in Lagos — never the server's zone. */
export function formatReceiptDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

export function formatSequentialReceiptNumber(year: number, n: number): string {
  return `RCP/${year}/${String(n).padStart(6, "0")}`;
}

/** The calendar year of a moment in Lagos — the receipt sequence's year. */
export function lagosYear(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", year: "numeric" }).format(d));
}

export function buildBrandedReceiptHtml(r: ReceiptData): string {
  const e = escapeHtml;
  const brand = safeBrandColor(r.school.primaryColor);
  const balance = Math.max(r.invoice.totalDue - r.invoice.totalPaidAfter, 0);
  const method = METHOD_LABELS[r.method] ?? r.method.replace(/_/g, " ").toLowerCase();
  const contact = [r.school.phone, r.school.email].filter((x): x is string => !!x && x.trim() !== "");

  const line = (label: string, value: string) =>
    `<tr><th scope="row">${e(label)}</th><td>${value}</td></tr>`;

  const receivedBy = r.receivedBy
    ? `${e(r.receivedBy.name)}${r.receivedBy.role ? ` <span class="muted">(${e(r.receivedBy.role)})</span>` : ""}`
    : "Paid online (Paystack)";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Receipt ${e(r.receiptNumber)} — ${e(r.school.name)}</title>
<style>
  :root { --brand: ${brand}; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #13262E; margin: 0; background: #fff; }
  .sheet { max-width: 680px; margin: 24px auto; padding: 28px 32px; border: 1px solid #e3e0d8; border-top: 6px solid var(--brand); }
  header { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; }
  .school { display: flex; gap: 14px; align-items: flex-start; }
  .logo { width: 64px; height: 64px; object-fit: contain; }
  .school h1 { margin: 0; font-size: 20px; letter-spacing: .02em; text-transform: uppercase; color: var(--brand); }
  .motto { margin: 2px 0 6px; font-style: italic; font-size: 12px; color: #555; }
  .school p { margin: 0; font-size: 12px; line-height: 1.5; }
  .doc { text-align: right; }
  .doc .title { font-size: 15px; font-weight: 700; letter-spacing: .08em; }
  .doc .no { font-size: 14px; font-weight: 700; color: var(--brand); margin-top: 4px; }
  .doc .date { font-size: 12px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th, td { text-align: left; vertical-align: top; padding: 9px 0; border-bottom: 1px solid #ece9e1; font-size: 13px; }
  th { width: 34%; font-weight: 600; color: #555; }
  .amount td { font-size: 20px; font-weight: 700; }
  .words { font-size: 13px; font-style: italic; }
  .muted { color: #666; font-weight: 400; }
  .totals { display: flex; justify-content: space-between; gap: 8px; margin-top: 16px; padding: 10px 12px; background: #F7F5EF; font-size: 12px; }
  .totals b { display: block; font-size: 14px; }
  footer { margin-top: 22px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 12px; }
  .thanks { font-weight: 600; color: var(--brand); }
  .actions { max-width: 680px; margin: 16px auto 0; text-align: right; }
  .actions button { font: inherit; font-size: 14px; padding: 8px 18px; border: 0; border-radius: 6px; background: var(--brand); color: #fff; cursor: pointer; }
  @page { size: A5; margin: 10mm; }
  @media print {
    .sheet { margin: 0; border: none; border-top: 6px solid var(--brand); max-width: none; }
    .actions { display: none; }
  }
</style>
</head>
<body>
<div class="actions"><button type="button" onclick="window.print()">Print or save as PDF</button></div>
<div class="sheet">
<header>
  <div class="school">
    ${r.school.logoDataUri ? `<img class="logo" src="${r.school.logoDataUri}" alt="" />` : ""}
    <div>
      <h1>${e(r.school.name)}</h1>
      ${r.school.motto ? `<p class="motto">${e(r.school.motto)}</p>` : ""}
      ${r.school.address ? `<p>${e(r.school.address)}</p>` : ""}
      ${contact.length > 0 ? `<p>${contact.map(e).join(" · ")}</p>` : ""}
    </div>
  </div>
  <div class="doc">
    <div class="title">OFFICIAL RECEIPT</div>
    <div class="no">No. ${e(r.receiptNumber)}</div>
    <div class="date">${e(formatReceiptDate(r.paidAt))}</div>
  </div>
</header>
<table>
  ${line(
    "Received from",
    `The parent/guardian of <b>${e(r.student.name)}</b><br /><span class="muted">Admission no. ${e(r.student.admissionNumber)}${
      r.student.className ? ` · ${e(r.student.className)}` : ""
    }</span>`,
  )}
  ${r.termLabel ? line("For", `School fees — ${e(r.termLabel)}`) : ""}
  <tr class="amount"><th scope="row">Amount</th><td>${e(formatKobo(r.amount))}</td></tr>
  <tr><th scope="row">In words</th><td class="words">${e(receiptAmountInWords(r.amount))}</td></tr>
  ${line("Paid by", `${e(method)}${r.reference ? ` · Ref. ${e(r.reference)}` : ""}`)}
</table>
<div class="totals">
  <div>Invoice total<b>${e(formatKobo(r.invoice.totalDue))}</b></div>
  <div>Paid to date<b>${e(formatKobo(r.invoice.totalPaidAfter))}</b></div>
  <div>Balance<b>${e(formatKobo(balance))}</b></div>
</div>
<footer>
  <div>Received by: ${receivedBy}</div>
  <div class="thanks">Thank you.</div>
</footer>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Issuing — inside the payment's own transaction.
// ---------------------------------------------------------------------------

/**
 * Draw the next receipt number for (school, year). ONE atomic statement: the
 * upsert takes a row lock, so concurrent payments queue and get distinct
 * numbers, and because it runs in the caller's transaction a rollback returns
 * the number. Runs under the caller's tenant GUC; RLS scopes the row.
 */
export async function allocateReceiptNumber(db: PrismaClient, schoolId: string, year: number): Promise<string> {
  const rows = await db.$queryRaw<Array<{ last_number: number }>>`
    INSERT INTO receipt_sequences (school_id, year, last_number, updated_at)
    VALUES (${schoolId}, ${year}, 1, NOW())
    ON CONFLICT (school_id, year)
    DO UPDATE SET last_number = receipt_sequences.last_number + 1, updated_at = NOW()
    RETURNING last_number`;
  const n = rows[0]?.last_number;
  if (typeof n !== "number") throw new Error("receipt sequence returned no number");
  return formatSequentialReceiptNumber(year, n);
}

type LogoExt = "png" | "jpg" | "webp";
const LOGO_MIME: Record<LogoExt, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

function logoExt(logoUrl: string | null): LogoExt | null {
  if (!logoUrl) return null;
  const ext = logoUrl.split(".").pop();
  return ext === "png" || ext === "jpg" || ext === "webp" ? ext : null;
}

// Logos change rarely and are read on every receipt; a short in-memory cache
// keeps the storage round trip off the hot path. Keyed by school and the
// stored logo path, so a new upload (a new path or extension) is picked up.
const LOGO_CACHE_TTL_MS = 10 * 60 * 1000;
const logoCache = new Map<string, { at: number; value: string | null }>();

/**
 * The school's logo as a data URI for a receipt — fetched OUTSIDE any
 * transaction (a storage download inside one is what made receipts slow
 * enough to time out). Never throws: a missing, unreadable or oversized logo
 * gives a receipt without one.
 */
export async function loadReceiptLogo(
  storage: StorageService,
  schoolId: string,
  logoUrl: string | null,
): Promise<string | null> {
  const key = `${schoolId}:${logoUrl ?? ""}`;
  const hit = logoCache.get(key);
  if (hit && Date.now() - hit.at < LOGO_CACHE_TTL_MS) return hit.value;
  const value = await loadLogoDataUri(storage, schoolId, logoUrl);
  logoCache.set(key, { at: Date.now(), value });
  return value;
}

async function loadLogoDataUri(storage: StorageService, schoolId: string, logoUrl: string | null): Promise<string | null> {
  const ext = logoExt(logoUrl);
  if (!ext) return null;
  try {
    const bytes = await storage.get(schoolId, { kind: "school-logo", ext });
    if (bytes.length > RECEIPT_LOGO_MAX_BYTES) {
      logger.warn(`School ${schoolId} logo is ${bytes.length} bytes — left off receipts (limit ${RECEIPT_LOGO_MAX_BYTES}).`);
      return null;
    }
    return `data:${LOGO_MIME[ext]};base64,${bytes.toString("base64")}`;
  } catch (err) {
    // A missing or unreadable logo must never block a payment's receipt.
    logger.warn(`School ${schoolId} logo could not be read for a receipt: ${String(err)}`);
    return null;
  }
}

/**
 * Gather, render and store a payment's receipt. `receiptNumber` is passed on
 * re-issue (the number never changes); otherwise one is drawn.
 */
export async function issueReceipt(
  db: PrismaClient,
  storage: StorageService,
  args: {
    schoolId: string;
    paymentId: string;
    totalPaidAfter: number;
    receiptNumber?: string;
    /** From loadReceiptLogo, fetched before the transaction opened. */
    logoDataUri: string | null;
  },
): Promise<{ receiptNumber: string; receiptUrl: string }> {
  const payment = await db.payment.findUniqueOrThrow({
    where: { id: args.paymentId },
    select: {
      invoiceId: true,
      studentId: true,
      amount: true,
      method: true,
      reference: true,
      recordedBy: true,
      paidAt: true,
      createdAt: true,
    },
  });
  const paidAt = payment.paidAt ?? payment.createdAt;

  // Only the school and the invoice are required. A missing student or term
  // (plain FKs) yields a plainer receipt, never a refused payment: the money
  // was received, and the receipt must still be issued.
  const [school, student, invoice] = await Promise.all([
    db.school.findUniqueOrThrow({
      where: { id: args.schoolId },
      select: { name: true, motto: true, address: true, phone: true, email: true, primaryColor: true },
    }),
    db.student.findUnique({
      where: { id: payment.studentId },
      select: { firstName: true, middleName: true, lastName: true, admissionNumber: true },
    }),
    db.invoice.findUniqueOrThrow({
      where: { id: payment.invoiceId },
      select: { totalDue: true, termId: true, classArmId: true },
    }),
  ]);

  const [term, arm, recorder] = await Promise.all([
    db.term.findUnique({
      where: { id: invoice.termId },
      select: { name: true, academicYear: { select: { label: true } } },
    }),
    invoice.classArmId
      ? db.classArm.findUnique({ where: { id: invoice.classArmId }, select: { name: true } })
      : Promise.resolve(null),
    payment.recordedBy
      ? db.user.findUnique({
          where: { id: payment.recordedBy },
          select: {
            firstName: true,
            lastName: true,
            roles: { select: { role: { select: { name: true } } } },
          },
        })
      : Promise.resolve(null),
  ]);

  const receiptNumber = args.receiptNumber ?? (await allocateReceiptNumber(db, args.schoolId, lagosYear(paidAt)));

  const html = buildBrandedReceiptHtml({
    receiptNumber,
    paidAt,
    school: {
      name: school.name,
      motto: school.motto,
      address: school.address,
      phone: school.phone,
      email: school.email,
      primaryColor: school.primaryColor,
      logoDataUri: args.logoDataUri,
    },
    student: {
      name: student ? [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") : "the student",
      admissionNumber: student?.admissionNumber ?? "—",
      className: arm?.name ?? null,
    },
    termLabel: term ? `${term.name} ${term.academicYear.label}` : null,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference,
    invoice: { totalDue: invoice.totalDue, totalPaidAfter: args.totalPaidAfter },
    // An online payment was received by Paystack, whoever made the link.
    receivedBy: recorder && payment.method !== "PAYSTACK"
      ? {
          name: `${recorder.firstName} ${recorder.lastName}`,
          role: recorder.roles[0]?.role.name ?? null,
        }
      : null,
  });

  const receiptUrl = await storage.put(
    args.schoolId,
    { kind: "payment-receipt", paymentId: args.paymentId },
    Buffer.from(html, "utf8"),
    "text/html",
    "inline",
  );
  return { receiptNumber, receiptUrl };
}
