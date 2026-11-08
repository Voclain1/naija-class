import { BILLING_RUN_PROMPT, BILLING_RUN_SYSTEM, BILLING_RUN_TASK } from "@school-kit/ai";
import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { billingToolRegistry } from "./billing-tools.js";
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, parseFeatureSwitches,
  type BillingContextDto, type BillingRequestInput, type BillingRunDto, type BillingRunInput,
} from "@school-kit/types";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service.js";
import { InvoiceGenerationService } from "./invoice-generation.service.js";
import { buildBillingPreview } from "./billing-run-preview.js";
import { resolveBillingRequest } from "./billing-request.js";

interface Payload { input: BillingRunInput; preview: ReturnType<typeof buildBillingPreview>; termLabel: string }
interface RunRow {
  id: string; status: "PENDING" | "COMPLETED"; payload: Payload;
  preview_hash: string; expires_at: Date; created_at: Date; approved_at: Date | null;
  result: BillingRunDto["result"];
}

@Injectable()
export class BillingRunsService {
  constructor(private readonly invoices: InvoiceGenerationService, private readonly features: FeatureSwitchesService, private readonly ai: AiGenerationService) {}

  async available(auth: AuthContext): Promise<{ enabled: boolean }> {
    return { enabled: await this.features.isOn(auth.schoolId, "assistant-billing") };
  }

  async context(auth: AuthContext): Promise<BillingContextDto> {
    return withTenant(auth.schoolId, async (db) => {
      await this.access(db, auth, false);
      return this.readContext(db, auth);
    });
  }

  async request(auth: AuthContext, input: BillingRequestInput, ip: string | null): Promise<BillingRunDto> {
    const context = await this.context(auth);
    const classArmIds = resolveBillingRequest(input.request, context, input.termId);
    const scope = { termId: input.termId, classArmIds, dueDate: input.dueDate };
    let checked = false;
    let requested = false;
    const registry = billingToolRegistry(async () => {
      const payload = await withTenant(auth.schoolId, async (db) => {
        await this.access(db, auth, false);
        return this.preview(db, auth, scope);
      }, { timeoutMs: 30_000, isolationLevel: "Serializable", label: "billing-tool-preview" });
      checked = true;
      return { classCount: payload.preview.arms.length, newInvoiceCount: payload.preview.createCount,
        existingInvoiceCount: payload.preview.skipCount,
        classesMissingFees: payload.preview.arms.filter((a) => a.missingFees).length };
    }, async () => {
      await this.context(auth); // fresh feature, active status and grant check
      requested = checked;
      return requested;
    });
    const turn = await this.ai.runConversationTurn({
      schoolId: auth.schoolId, userId: auth.userId, prompt: BILLING_RUN_PROMPT,
      system: BILLING_RUN_SYSTEM, history: [{ role: "user", text: BILLING_RUN_TASK }],
      ...registry.forTurn(auth), maxSteps: 4, maxInputTokensPerTurn: 12_000,
    });
    if (turn.outcome !== "answered" || !requested) throw new ConflictError("BILLING_NOT_PREPARED", "The assistant could not finish preparing the run. You can retry or choose classes directly. No invoices were issued.");
    // The model's prose is never stored or used to choose a monetary action.
    // A fresh authoritative preview is the ONLY content of the approval card.
    return this.prepare(auth, scope, ip);
  }

  async prepare(auth: AuthContext, input: BillingRunInput, ip: string | null): Promise<BillingRunDto> {
    // No model call or external side effect inside any transaction.
    return withTenant(auth.schoolId, async (db) => {
      await this.access(db, auth, false);
      const payload = await this.preview(db, auth, input);
      const id = randomUUID();
      const expires = new Date(Date.now() + 30 * 60_000);
      const rows = await db.$queryRaw<RunRow[]>`
        INSERT INTO assistant_billing_runs (id, school_id, requested_by, payload, preview_hash, expires_at)
        VALUES (${id}, ${auth.schoolId}, ${auth.userId}, ${JSON.stringify(payload)}::jsonb,
                ${payload.preview.previewHash}, ${expires}) RETURNING *
      `;
      await this.audit(db, auth, id, "assistant.billing.prepare", ip, { createCount: payload.preview.createCount });
      return this.dto(rows[0]!);
    }, { timeoutMs: 30_000, isolationLevel: "Serializable", label: "billing-preview" });
  }

  async list(auth: AuthContext): Promise<BillingRunDto[]> {
    return withTenant(auth.schoolId, async (db) => {
      await this.access(db, auth, false);
      const rows = await db.$queryRaw<RunRow[]>`
        SELECT * FROM assistant_billing_runs WHERE school_id = ${auth.schoolId}
        ORDER BY created_at DESC, id LIMIT 20
      `;
      return rows.map((r) => this.dto(r));
    });
  }

  async get(auth: AuthContext, id: string): Promise<BillingRunDto> {
    return withTenant(auth.schoolId, async (db) => {
      await this.access(db, auth, false);
      const rows = await db.$queryRaw<RunRow[]>`
        SELECT * FROM assistant_billing_runs WHERE school_id = ${auth.schoolId} AND id = ${id}
      `;
      if (!rows[0]) throw new NotFoundError("Billing run not found.");
      return this.dto(rows[0]);
    });
  }

  async approve(auth: AuthContext, id: string, expectedHash: string, ip: string | null): Promise<BillingRunDto> {
    try {
      return await withTenant(auth.schoolId, async (db) => {
        // Lock grants for this transaction, so a simultaneous revocation cannot
        // land halfway through this execution. No authorization from the model.
        await this.access(db, auth, true);
        const rows = await db.$queryRaw<RunRow[]>`
          SELECT * FROM assistant_billing_runs WHERE school_id = ${auth.schoolId} AND id = ${id} FOR UPDATE
        `;
        const run = rows[0];
        if (!run) throw new NotFoundError("Billing run not found.");
        if (run.preview_hash !== expectedHash) throw new ConflictError("BILLING_PREVIEW_CHANGED", "Review the billing preview again.");
        // A lost HTTP response after commit is harmless: no second issuance.
        if (run.status === "COMPLETED") return this.dto(run);
        if (run.expires_at.getTime() <= Date.now()) throw new ConflictError("BILLING_EXPIRED", "This preview expired. Prepare a new billing run.");
        const fresh = await this.preview(db, auth, run.payload.input);
        if (fresh.preview.previewHash !== run.preview_hash) {
          throw new ConflictError("BILLING_PREVIEW_CHANGED", "The roster, fees, charges or invoices changed. Prepare a new preview before approving.");
        }
        if (fresh.preview.blockers.length) throw new ConflictError("BILLING_BLOCKED", "Resolve the preview's exceptions before issuing invoices.");
        const result: NonNullable<BillingRunDto["result"]> = { created: 0, skipped: 0, totalDueKobo: "0", invoiceIds: [] };
        let total = 0n;
        for (const arm of fresh.preview.arms) {
          await this.access(db, auth, true);
          const issued = await this.invoices.generateForArmInTransaction(auth,
            { termId: fresh.input.termId, classArmId: arm.classArmId, dueDate: fresh.input.dueDate },
            { ipAddress: ip, assistantRunId: run.id }, db);
          result.created += issued.created; result.skipped += issued.skipped;
          for (const invoice of issued.invoices) {
            result.invoiceIds.push(invoice.id); total += BigInt(invoice.totalDue);
          }
        }
        result.totalDueKobo = total.toString();
        if (result.created !== fresh.preview.createCount || result.skipped !== fresh.preview.skipCount || result.totalDueKobo !== fresh.preview.totalDueKobo) {
          throw new ConflictError("BILLING_RESULT_CHANGED", "Billing did not match the approved preview. Nothing from this run was saved.");
        }
        const [completed] = await db.$queryRaw<RunRow[]>`
          UPDATE assistant_billing_runs SET status = 'COMPLETED', approved_by = ${auth.userId},
            approved_at = CURRENT_TIMESTAMP, result = ${JSON.stringify(result)}::jsonb
          WHERE school_id = ${auth.schoolId} AND id = ${id} RETURNING *
        `;
        await this.audit(db, auth, id, "assistant.billing.complete", ip, { created: result.created, skipped: result.skipped });
        return this.dto(completed!);
      }, { timeoutMs: 60_000, isolationLevel: "Serializable", retryConnectionErrors: false, label: "billing-approve" });
    } catch (e) {
      // Serializable races and unique-invoice races roll back the WHOLE run.
      // Do not auto-retry a money write; the person retries after inspection.
      const code = (e as { code?: string }).code;
      const meta = (e as { meta?: { code?: string; driverAdapterError?: { cause?: { code?: string; originalCode?: string } } } }).meta;
      const pgCode = meta?.code ?? meta?.driverAdapterError?.cause?.code ?? meta?.driverAdapterError?.cause?.originalCode;
      if (code === "P2034" || code === "P2002" || ["40001", "40P01", "23505"].includes(pgCode ?? "")) {
        throw new ConflictError("BILLING_RETRY", "Another billing action ran at the same time. Check this run, then retry or prepare a fresh preview.");
      }
      throw e;
    }
  }

  private async readContext(db: PrismaClient, auth: AuthContext): Promise<BillingContextDto> {
    const terms = await db.term.findMany({ where: { schoolId: auth.schoolId }, include: { academicYear: true }, orderBy: [{ academicYear: { startDate: "desc" } }, { sequence: "asc" }] });
    const arms = await db.classArm.findMany({ where: { schoolId: auth.schoolId, isActive: true }, include: { classLevel: true }, orderBy: { name: "asc" } });
    return {
      terms: terms.map((t) => ({ id: t.id, name: t.name, year: t.academicYear.label, isCurrent: t.isCurrent })),
      arms: arms.map((a) => ({ id: a.id, name: a.name, level: a.classLevel.name })),
    };
  }

  private async preview(db: PrismaClient, auth: AuthContext, input: BillingRunInput): Promise<Payload> {
    const context = await this.readContext(db, auth);
    const term = context.terms.find((t) => t.id === input.termId);
    if (!term) throw new NotFoundError("Term not found.");
    const ids = [...new Set(input.classArmIds)].sort();
    if (!ids.length || ids.length > 20) throw new ConflictError("BILLING_LIMIT", "Choose between one and twenty classes.");
    // Refuse before doing N-per-student work on a large selection.
    const count = await db.enrollment.count({ where: { schoolId: auth.schoolId, termId: input.termId, classArmId: { in: ids }, status: "ENROLLED" } });
    if (count > 200) throw new ConflictError("BILLING_LIMIT", "Select fewer classes: a run can cover up to 200 enrolled students.");
    const selected: Parameters<typeof buildBillingPreview>[1] = [];
    for (const id of ids) {
      const arm = context.arms.find((a) => a.id === id);
      if (!arm) throw new NotFoundError("Class not found or inactive.");
      selected.push({ id, label: `${arm.level} · ${arm.name}`, rows: await this.invoices.previewForArmInTransaction(auth, { termId: input.termId, classArmId: id }, db) });
    }
    const normalised = { ...input, classArmIds: ids };
    return { input: normalised, preview: buildBillingPreview(normalised, selected, `${term.year} · ${term.name}`), termLabel: `${term.year} · ${term.name}` };
  }

  private async access(db: PrismaClient, auth: AuthContext, write: boolean): Promise<void> {
    const [school] = await db.$queryRaw<{ is_active: boolean; suspended_at: Date | null; status: string; feature_switches: unknown }[]>`
      SELECT is_active, suspended_at, status, feature_switches FROM schools WHERE id = ${auth.schoolId} FOR SHARE
    `;
    if (!school || !school.is_active || school.suspended_at || school.status === "ARCHIVED") throw new ForbiddenError("School access is unavailable.");
    if (this.features.isPlatformDisabled("assistant-billing") || !parseFeatureSwitches(school.feature_switches)["assistant-billing"]) throw new ForbiddenError("The invoice assistant is switched off.");
    const grants = await db.$queryRaw<{ is_active: boolean; permissions: unknown }[]>`
      SELECT u.is_active, r.permissions FROM users u
      JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
      WHERE u.school_id = ${auth.schoolId} AND u.id = ${auth.userId} FOR SHARE OF u, ur, r
    `;
    if (!grants.length || grants.some((g) => !g.is_active)) throw new UnauthorizedError("USER_INACTIVE", "Your account is unavailable.");
    const held = new Set(grants.flatMap((g) => Array.isArray(g.permissions) ? g.permissions : []));
    if (!held.has("*") && (!held.has("invoice.read") || (write && !held.has("invoice.issue")))) throw new ForbiddenError("Not permitted.");
  }

  private dto(row: RunRow): BillingRunDto {
    return {
      id: row.id, status: row.status, ...row.payload.preview,
      termId: row.payload.input.termId, termLabel: row.payload.termLabel,
      dueDate: row.payload.input.dueDate ?? null, previewHash: row.preview_hash,
      expiresAt: row.expires_at.toISOString(), createdAt: row.created_at.toISOString(),
      approvedAt: row.approved_at?.toISOString() ?? null, result: row.result,
    };
  }

  private async audit(db: PrismaClient, auth: AuthContext, id: string, action: string, ip: string | null, metadata: Record<string, string | number>) {
    await db.auditLog.create({ data: { schoolId: auth.schoolId, userId: auth.userId, action,
      entityType: "assistant_billing_run", entityId: id, ipAddress: ip,
      metadata: { via: "assistant", proposalId: id, ...metadata } } });
  }
}
