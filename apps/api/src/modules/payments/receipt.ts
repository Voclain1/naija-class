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

/**
 * A monogram for a school with no logo: up to three initials, so the header
 * never has a hole where a crest should be.
 */
export function schoolMonogram(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((word) => /[A-Za-z]/.test(word))
    .map((word) => word[0] as string)
    .slice(0, 3)
    .join("");
  return letters.toUpperCase() || "S";
}

export function buildBrandedReceiptHtml(r: ReceiptData): string {
  const e = escapeHtml;
  const brand = safeBrandColor(r.school.primaryColor);
  const balance = Math.max(r.invoice.totalDue - r.invoice.totalPaidAfter, 0);
  const settled = balance === 0;
  const method = METHOD_LABELS[r.method] ?? r.method.replace(/_/g, " ").toLowerCase();
  const contact = [r.school.phone, r.school.email].filter((x): x is string => !!x && x.trim() !== "");

  const row = (label: string, value: string) =>
    `<div class="row"><div class="label">${e(label)}</div><div class="value">${value}</div></div>`;

  const receivedBy = r.receivedBy
    ? `${e(r.receivedBy.name)}${r.receivedBy.role ? ` <span class="muted">· ${e(r.receivedBy.role)}</span>` : ""}`
    : "Paid online (Paystack)";

  // Typography is deliberately system fonts, not a web font: this document is
  // also turned into a PDF on a phone (expo-print) and printed in offices with
  // poor connections. A downloaded font that fails to arrive would re-flow the
  // whole receipt; Georgia and Helvetica/Arial are everywhere.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Receipt ${e(r.receiptNumber)} — ${e(r.school.name)}</title>
<style>
  :root {
    --brand: ${brand};
    --ink: #10242B;
    --muted: #6B7280;
    --hairline: #E5E1D8;
    --paper: #FFFFFF;
    --tint: #F7F5EF;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #EFEDE6; }
  body {
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .actions { max-width: 760px; margin: 20px auto 0; text-align: right; }
  .actions button {
    font: inherit; font-size: 14px; font-weight: 600; letter-spacing: .01em;
    padding: 10px 22px; border: 0; border-radius: 999px;
    background: var(--brand); color: #fff; cursor: pointer;
  }
  .sheet {
    position: relative; overflow: hidden;
    max-width: 760px; margin: 20px auto 40px; padding: 0 0 34px;
    background: var(--paper); border: 1px solid var(--hairline);
    box-shadow: 0 18px 48px rgba(16, 36, 43, .10);
  }
  .band { height: 5px; background: var(--brand); }
  .inner { padding: 34px 46px 0; }

  header { display: flex; gap: 26px; align-items: flex-start; justify-content: space-between; }
  .identity { display: flex; gap: 18px; align-items: flex-start; min-width: 0; }
  .crest { width: 70px; height: 70px; object-fit: contain; flex: none; }
  .monogram {
    width: 70px; height: 70px; flex: none; border-radius: 50%;
    border: 2px solid var(--brand); color: var(--brand);
    display: flex; align-items: center; justify-content: center;
    font-family: Georgia, "Times New Roman", serif; font-size: 24px; letter-spacing: .04em;
  }
  h1 {
    margin: 0; font-family: Georgia, "Times New Roman", serif;
    font-size: 25px; line-height: 1.15; letter-spacing: .01em; color: var(--ink);
  }
  .motto { margin: 5px 0 0; font-family: Georgia, serif; font-style: italic; font-size: 13px; color: var(--brand); }
  .contact { margin: 9px 0 0; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .doc { text-align: right; flex: none; }
  .doc .kicker { font-size: 10px; font-weight: 700; letter-spacing: .22em; color: var(--muted); }
  .doc .no {
    margin-top: 7px; font-family: Georgia, "Times New Roman", serif;
    font-size: 19px; font-weight: 700; color: var(--brand); white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .doc .date { margin-top: 3px; font-size: 12px; color: var(--muted); white-space: nowrap; }

  .rule { height: 1px; background: var(--hairline); margin: 26px 0 4px; }
  .rule.thick { height: 2px; background: var(--ink); opacity: .08; }

  .row { display: flex; gap: 22px; padding: 13px 0; border-bottom: 1px solid var(--hairline); }
  .label { width: 34%; flex: none; font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); padding-top: 3px; }
  .value { flex: 1; font-size: 14px; line-height: 1.55; min-width: 0; word-wrap: break-word; }
  .value .name { font-weight: 700; letter-spacing: .01em; }
  .muted { color: var(--muted); }
  .sub { display: block; margin-top: 3px; font-size: 12px; color: var(--muted); }

  .amount { display: flex; align-items: flex-end; justify-content: space-between; gap: 22px; padding: 20px 0 16px; border-bottom: 1px solid var(--hairline); }
  .amount .figure {
    font-family: Georgia, "Times New Roman", serif; font-size: 38px; line-height: 1;
    font-variant-numeric: tabular-nums; letter-spacing: -.01em;
  }
  .chip {
    font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase;
    padding: 7px 14px; border-radius: 999px; white-space: nowrap;
    background: ${settled ? "rgba(14, 92, 67, .10)" : "rgba(224, 165, 46, .16)"};
    color: ${settled ? "#0E5C43" : "#8A6410"};
  }
  .words { margin-top: 14px; padding: 12px 16px; background: var(--tint); border-left: 3px solid var(--brand); font-family: Georgia, serif; font-style: italic; font-size: 14px; }

  .ledger { display: flex; gap: 14px; margin-top: 22px; }
  .ledger div { flex: 1; padding: 13px 16px; background: var(--tint); }
  .ledger .k { font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
  .ledger .v { margin-top: 5px; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .ledger .v.due { color: ${settled ? "var(--ink)" : "#8A6410"}; }

  footer { display: flex; align-items: flex-end; justify-content: space-between; gap: 26px; margin-top: 30px; }
  .sign { min-width: 220px; }
  .sign .line { height: 1px; background: var(--ink); opacity: .35; }
  .sign .who { margin-top: 7px; font-size: 12px; }
  .sign .cap { margin-top: 2px; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
  .thanks { text-align: right; }
  .thanks .big { font-family: Georgia, serif; font-style: italic; font-size: 16px; color: var(--brand); }
  .thanks .note { margin-top: 5px; font-size: 10px; color: var(--muted); max-width: 260px; }

  .stamp {
    position: absolute; right: 46px; bottom: 96px; transform: rotate(-16deg);
    border: 3px double ${settled ? "rgba(14, 92, 67, .30)" : "rgba(138, 100, 16, .30)"};
    color: ${settled ? "rgba(14, 92, 67, .32)" : "rgba(138, 100, 16, .32)"};
    border-radius: 10px; padding: 8px 18px;
    font-size: 19px; font-weight: 700; letter-spacing: .18em;
    pointer-events: none;
  }

  @page { size: A4; margin: 12mm; }
  @media print {
    html, body { background: #fff; }
    .actions { display: none; }
    .sheet { margin: 0; max-width: none; border: none; box-shadow: none; }
    .inner { padding: 0 6mm; }
  }
  @media (max-width: 600px) {
    .inner { padding: 22px 20px 0; }
    header { flex-direction: column; gap: 16px; }
    .doc { text-align: left; }
    .row { flex-direction: column; gap: 4px; }
    .label { width: auto; }
    .ledger { flex-direction: column; }
    .stamp { display: none; }
  }
</style>
</head>
<body>
<div class="actions"><button type="button" onclick="window.print()">Print or save as PDF</button></div>
<div class="sheet">
<div class="band"></div>
<div class="inner">
  <header>
    <div class="identity">
      ${
        r.school.logoDataUri
          ? `<img class="crest" src="${r.school.logoDataUri}" alt="" />`
          : `<div class="monogram">${e(schoolMonogram(r.school.name))}</div>`
      }
      <div>
        <h1>${e(r.school.name)}</h1>
        ${r.school.motto ? `<p class="motto">${e(r.school.motto)}</p>` : ""}
        ${r.school.address ? `<p class="contact">${e(r.school.address)}</p>` : ""}
        ${contact.length > 0 ? `<p class="contact">${contact.map(e).join(" &nbsp;·&nbsp; ")}</p>` : ""}
      </div>
    </div>
    <div class="doc">
      <div class="kicker">OFFICIAL RECEIPT</div>
      <div class="no">No. ${e(r.receiptNumber)}</div>
      <div class="date">${e(formatReceiptDate(r.paidAt))}</div>
    </div>
  </header>

  <div class="rule thick"></div>

  ${row(
    "Received from",
    `<span class="name">${e(r.student.name)}</span><span class="sub">The parent/guardian · Admission no. ${e(r.student.admissionNumber)}${
      r.student.className ? ` · ${e(r.student.className)}` : ""
    }</span>`,
  )}
  ${r.termLabel ? row("For", `School fees<span class="sub">${e(r.termLabel)}</span>`) : ""}
  ${row("Paid by", `${e(method)}${r.reference ? `<span class="sub">Ref. ${e(r.reference)}</span>` : ""}`)}

  <div class="amount">
    <div>
      <div class="label">Amount received</div>
      <div class="figure">${e(formatKobo(r.amount))}</div>
    </div>
    <div class="chip">${settled ? "Paid in full" : `${e(formatKobo(balance))} outstanding`}</div>
  </div>
  <div class="words">${e(receiptAmountInWords(r.amount))}</div>

  <div class="ledger">
    <div><div class="k">Invoice total</div><div class="v">${e(formatKobo(r.invoice.totalDue))}</div></div>
    <div><div class="k">Paid to date</div><div class="v">${e(formatKobo(r.invoice.totalPaidAfter))}</div></div>
    <div><div class="k">Balance</div><div class="v due">${e(formatKobo(balance))}</div></div>
  </div>

  <footer>
    <div class="sign">
      <div class="line"></div>
      <div class="who">Received by: ${receivedBy}</div>
      <div class="cap">For ${e(r.school.name)}</div>
    </div>
    <div class="thanks">
      <div class="big">Thank you.</div>
      <div class="note">Computer-generated receipt · No. ${e(r.receiptNumber)}</div>
    </div>
  </footer>
</div>
<div class="stamp">${settled ? "PAID" : "PART PAYMENT"}</div>
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
