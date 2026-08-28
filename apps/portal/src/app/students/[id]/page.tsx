"use client";

// Phase 4 / Slice 4 — per-child detail: profile summary + every invoice
// (each invoice's `items` array IS the fee structure as applied to that
// term — no separate fee-structure fetch, see this slice's plan-first §2).
// Slice 5 adds the "Pay" action itself (InvoiceCard below).
//
// Fetches GET /api/portal/students/:id and .../invoices in parallel. A 403
// here means this guardian isn't linked to this student (withGuardian on
// the API side) — same generic "not found" treatment as a genuinely
// unknown id, so the page never confirms or denies another family's child
// exists at this URL.

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type {
  PaystackInitResponseDto,
  PortalInvoiceDto,
  PortalParentSummaryDto,
  PortalStudentDto,
} from "@school-kit/types";

import { SignOutButton } from "@/components/sign-out-button";
import {
  buildLoginUrl,
  errorCodeFromBody,
  reasonFromErrorCode,
} from "@/lib/session-end";
import { StudentPortalAccess } from "@/components/student-portal-access";

type LoadState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "error"; message: string }
  | {
      kind: "loaded";
      student: PortalStudentDto;
      invoices: PortalInvoiceDto[];
      // Phase 5 / Slice 5. Fetched alongside the other two, but its failure is
      // NOT allowed to fail the page: a school that has never switched weekly
      // summaries on returns an empty list, and a transient error on this one
      // endpoint should not hide a parent's invoices. So it degrades to an
      // empty array rather than an error state — the section simply doesn't
      // render.
      summaries: PortalParentSummaryDto[];
    };

const STATUS_LABELS: Record<PortalInvoiceDto["status"], string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

const STATUS_STYLES: Record<PortalInvoiceDto["status"], string> = {
  DRAFT: "bg-muted text-muted-foreground",
  ISSUED: "bg-blue-500/10 text-blue-600",
  PARTIALLY_PAID: "bg-amber-500/10 text-amber-600",
  PAID: "bg-emerald-500/10 text-emerald-600",
  OVERDUE: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground",
  REFUNDED: "bg-muted text-muted-foreground",
};

// weekStart is a DATE from the API (no time-of-day, no zone). Parsed with an
// explicit UTC time and formatted in UTC so a guardian in Lagos (UTC+1) sees
// the Monday the API meant, not the Sunday before it — the exact off-by-one
// the DATE convention exists to avoid, which a naive `new Date(s)` +
// toLocaleDateString would reintroduce here at the display layer.
function formatWeek(weekStart: string | Date): string {
  const d = typeof weekStart === "string" ? new Date(`${weekStart.slice(0, 10)}T00:00:00Z`) : weekStart;
  return d.toLocaleDateString("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

// Paystack's business review cleared and the live key is in place
// (2026-08-13), so the "Test Mode" notice this page carried from
// 2026-07-31 is gone, along with the NEXT_PUBLIC_PAYSTACK_TEST_MODE flag
// that drove it. Removed rather than flipped to "false": that flag
// defaulted to TRUE (fail toward showing the warning), which was right
// while it existed but means a Vercel project that loses its env vars —
// something that has already happened once on this project, see CLAUDE.md
// on recreating a Vercel project — would put a "this is not a real
// payment" banner back in front of paying parents. Deleting the flag is
// the only way that cannot happen.
//
// Whether checkout is live or test is determined ENTIRELY by which
// PAYSTACK_SECRET_KEY the API holds, never by anything in this file.

async function parseErrorMessage(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null);
  return body !== null && typeof body === "object" && "error" in body
    ? ((body as { error?: { message?: string } }).error?.message ??
        "Something went wrong. Try again.")
    : "Could not reach the server. Try again in a moment.";
}

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [studentRes, invoicesRes, summariesRes] = await Promise.all([
          fetch(`/api/portal/students/${params.id}`),
          fetch(`/api/portal/students/${params.id}/invoices`),
          // Deliberately not included in the status checks below. See the
          // note on LoadState.summaries: this endpoint is additive, and a
          // failure here must not take the page down.
          fetch(`/api/portal/students/${params.id}/summaries`).catch(() => null),
        ]);

        if (studentRes.status === 401 || invoicesRes.status === 401) {
          // Say WHY, and remember which child's page they were on (F-10).
          // Read the code off whichever response actually 401'd.
          const unauthorised = studentRes.status === 401 ? studentRes : invoicesRes;
          // Blank the page BEFORE anything else. A redirect is not instant,
          // and until it lands this component would otherwise keep rendering
          // whatever was already loaded — a child's name and fee balance, on
          // a screen whose session has just been rejected. Dropping back to
          // "loading" makes "no stale protected content after a 401" a
          // property of the component rather than a race against navigation.
          //
          // This matters most on the shared-device Back path: the browser
          // restores the rendered page, the refetch 401s, and the gap before
          // the redirect is exactly the window someone else could read.
          if (!cancelled) setState({ kind: "loading" });
          const errBody: unknown = await unauthorised.json().catch(() => null);
          router.replace(
            buildLoginUrl({
              reason: reasonFromErrorCode(errorCodeFromBody(errBody)),
              next: `${window.location.pathname}${window.location.search}`,
            }),
          );
          return;
        }
        // Checked together, not just studentRes: both endpoints run the
        // same withGuardian() check independently, so in normal operation
        // they always agree — but they're fetched in parallel, and a
        // guardian-unlink race between the two requests could make only
        // one of them fail. Without this, that case would fall through to
        // the generic-message branch below and surface withGuardian's raw
        // "Guardian is not linked to this student" — more specific than
        // the deliberately generic treatment the student-fetch 403 gets,
        // and inconsistent depending on which request happened to fail.
        if (
          studentRes.status === 403 ||
          studentRes.status === 404 ||
          invoicesRes.status === 403 ||
          invoicesRes.status === 404
        ) {
          if (!cancelled) setState({ kind: "not-found" });
          return;
        }
        if (!studentRes.ok) {
          const message = await parseErrorMessage(studentRes);
          if (!cancelled) setState({ kind: "error", message });
          return;
        }
        if (!invoicesRes.ok) {
          const message = await parseErrorMessage(invoicesRes);
          if (!cancelled) setState({ kind: "error", message });
          return;
        }

        const student = (await studentRes.json()) as PortalStudentDto;
        const invoices = ((await invoicesRes.json()) as { data: PortalInvoiceDto[] }).data;

        let summaries: PortalParentSummaryDto[] = [];
        if (summariesRes?.ok) {
          try {
            summaries = ((await summariesRes.json()) as { data: PortalParentSummaryDto[] }).data;
          } catch {
            // Malformed body — same treatment as a failed fetch: no section.
            summaries = [];
          }
        }

        if (!cancelled) setState({ kind: "loaded", student, invoices, summaries });
      } catch {
        if (!cancelled) {
          setState({
            kind: "error",
            message: "Could not reach the server. Try again in a moment.",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [params.id, router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      {/* Sign out is reachable from EVERY authenticated surface, not just
          the home page — a guardian who lands here from an emailed link
          should not have to navigate back to find it (F-06). */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Back to your children
        </Link>
        <SignOutButton />
      </div>

      {state.kind === "loading" && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {state.kind === "not-found" && (
        <p role="alert" className="text-sm text-destructive">
          We couldn&apos;t find that child on your account.
        </p>
      )}

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      {state.kind === "loaded" && (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {state.student.firstName} {state.student.lastName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {state.student.admissionNumber}
              {state.student.currentEnrollment
                ? ` · ${state.student.currentEnrollment.classArm.classLevel.name} ${state.student.currentEnrollment.classArm.name}`
                : " · Not enrolled this term"}
            </p>
          </header>

          {/* Account access sits directly under the header, above both
              weekly updates and invoices. It is the only control on this page
              that changes what the child can DO, and a parent reaching for it
              (often because something has gone wrong) should not have to
              scroll past a bill to find it. */}
          <StudentPortalAccess
            studentId={state.student.id}
            firstName={state.student.firstName}
          />

          {/* Weekly updates sit ABOVE invoices deliberately: a parent opening
              their child's page is more often checking on the child than on a
              bill, and this is the only section here that changes week to
              week. The section is absent entirely when the school hasn't
              switched the feature on — no empty state, because "your school
              doesn't do this" is not something a parent needs told. */}
          {state.summaries.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold tracking-tight">Weekly updates</h2>
              {state.summaries.map((s) => (
                <article key={s.id} className="rounded-lg border bg-card p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Week of {formatWeek(s.weekStart)}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed">{s.summary}</p>
                </article>
              ))}
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Invoices</h2>

            {state.invoices.length === 0 && (
              <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
                No invoices yet for this child.
              </div>
            )}

            {state.invoices.map((invoice) => (
              <InvoiceCard key={invoice.id} invoice={invoice} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

type PayState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "error"; message: string };

// Phase 4 / Slice 5 — the "Pay" action. No amount input: the server always
// charges the exact outstanding balance (see PortalPaymentsService's own
// comment on why), so this is a single button, not a form. A 409 here
// (INVOICE_ALREADY_PAID, PAYMENT_ALREADY_IN_PROGRESS) is a normal, expected
// outcome — e.g. a second tab, or a page the guardian didn't realise was
// already paid — shown inline via the server's own message, not a generic
// failure, matching how INVOICE_ALREADY_PAID's error message reads as
// production copy already ("This invoice is already fully paid.").
function InvoiceCard({ invoice }: { invoice: PortalInvoiceDto }) {
  const [payState, setPayState] = useState<PayState>({ kind: "idle" });
  const balance = invoice.totalDue - invoice.totalPaid;

  async function onPay() {
    setPayState({ kind: "starting" });
    try {
      const res = await fetch(
        `/api/portal/students/${invoice.studentId}/invoices/${invoice.id}/pay`,
        { method: "POST" },
      );
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          body !== null && typeof body === "object" && "error" in body
            ? ((body as { error?: { message?: string } }).error?.message ??
                "Something went wrong. Try again.")
            : "Could not reach the server. Try again in a moment.";
        setPayState({ kind: "error", message });
        return;
      }
      const { authorizationUrl } = body as PaystackInitResponseDto;
      window.location.href = authorizationUrl;
    } catch {
      setPayState({
        kind: "error",
        message: "Could not reach the server. Try again in a moment.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{invoice.term.name}</span>
          {invoice.dueDate && (
            <span className="text-xs text-muted-foreground">Due {invoice.dueDate}</span>
          )}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[invoice.status]}`}
        >
          {STATUS_LABELS[invoice.status]}
        </span>
      </div>

      <ul className="flex flex-col gap-1 text-sm">
        {invoice.items.map((item, idx) => (
          <li key={item.feeItemId + idx} className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <span>
                {item.categoryName} — {item.feeName}
              </span>
              <span>{formatNaira(item.amount)}</span>
            </div>
            {item.discountsApplied.map((discount) => (
              <div
                key={discount.ruleId}
                className="flex items-center justify-between pl-4 text-xs text-emerald-600"
              >
                <span>{discount.ruleName}</span>
                <span>-{formatNaira(discount.discountAmount)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1 border-t pt-3 text-sm">
        <div className="flex items-center justify-between font-medium">
          <span>Total due</span>
          <span>{formatNaira(invoice.totalDue)}</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Paid so far</span>
          <span>{formatNaira(invoice.totalPaid)}</span>
        </div>
        <div className="flex items-center justify-between font-medium">
          <span>Balance</span>
          <span>{formatNaira(balance)}</span>
        </div>
      </div>

      {payState.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {payState.message}
        </p>
      )}

      {balance > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={onPay}
            disabled={payState.kind === "starting"}
            className="h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {payState.kind === "starting" ? "Redirecting to payment…" : `Pay ${formatNaira(balance)}`}
          </button>
        </div>
      )}
    </div>
  );
}
