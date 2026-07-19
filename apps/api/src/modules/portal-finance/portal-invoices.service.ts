import { Injectable } from "@nestjs/common";

import { Prisma, withGuardian, withTenant, type PrismaClient } from "@school-kit/db";
import {
  InternalError,
  type InvoiceLineItemDto,
  type InvoiceStatus,
  type PortalInvoiceDto,
  type PortalInvoiceListResponse,
  type PortalInvoiceTermRefDto,
} from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";

// Invoice.termId is a plain FK, no Prisma relation (see schema.prisma's own
// comment on the column) — same reason InvoiceGenerationService.fetchTerm
// queries Term separately rather than via an `include`. Batched here
// (one extra query total, not one per invoice) since a student can have
// multiple invoices across terms.
const TERM_SELECT = {
  id: true,
  name: true,
  sequence: true,
} satisfies Prisma.TermSelect;

async function loadTermsByIds(
  db: PrismaClient,
  termIds: string[],
): Promise<Map<string, PortalInvoiceTermRefDto>> {
  if (termIds.length === 0) return new Map();
  const rows = await db.term.findMany({
    where: { id: { in: termIds } },
    select: TERM_SELECT,
  });
  return new Map(rows.map((t) => [t.id, t]));
}

const INVOICE_SELECT = {
  id: true,
  studentId: true,
  termId: true,
  status: true,
  items: true,
  totalAmount: true,
  totalDiscount: true,
  totalDue: true,
  totalPaid: true,
  dueDate: true,
  issuedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InvoiceSelect;

type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_SELECT }>;

function toPortalInvoiceDto(row: InvoiceRow, term: PortalInvoiceTermRefDto): PortalInvoiceDto {
  return {
    id: row.id,
    studentId: row.studentId,
    term,
    status: row.status as InvoiceStatus,
    items: row.items as unknown as InvoiceLineItemDto[],
    totalAmount: row.totalAmount,
    totalDiscount: row.totalDiscount,
    totalDue: row.totalDue,
    totalPaid: row.totalPaid,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    issuedAt: row.issuedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PortalInvoicesService {
  // GET /portal/students/:id/invoices — every invoice for one child, most
  // recent first. Same withTenant + withGuardian() composition as
  // PortalStudentsService.findById (Slice 3) — a caller-supplied studentId
  // path param always needs the explicit check, unlike a query filtered by
  // guardianId (see PortalStudentsService.list's own comment on that
  // distinction).
  //
  // No separate "fee structure" endpoint — each invoice's `items` array IS
  // the fee structure as applied to this student for that term. See this
  // slice's plan-first §2.
  async listForStudent(
    guardianCtx: GuardianAuthContext,
    studentId: string,
  ): Promise<PortalInvoiceListResponse> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, async (db2) => {
        const rows = await db2.invoice.findMany({
          where: { studentId },
          orderBy: { createdAt: "desc" },
          select: INVOICE_SELECT,
        });

        const terms = await loadTermsByIds(db2, [...new Set(rows.map((r) => r.termId))]);

        return {
          data: rows.map((row) => {
            const term = terms.get(row.termId);
            // Every invoice's termId is validated against a real Term row
            // at issue time (InvoiceGenerationService.fetchTerm) — this is
            // unreachable in practice, guarded rather than asserted with
            // `!` for the same reason PortalStudentsService.findById's own
            // impossible-branch comment gives.
            if (!term) {
              throw new InternalError(`Invoice ${row.id} references a missing term ${row.termId}.`);
            }
            return toPortalInvoiceDto(row, term);
          }),
        };
      }),
    );
  }
}
