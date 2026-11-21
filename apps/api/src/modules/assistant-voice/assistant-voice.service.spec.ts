import { randomUUID } from "node:crypto";

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AiAssistantTurn, AiCallRequest, AiCallResult, AiConversationRequest, AiConversationResult, AiToolCall, AnthropicPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";
import type { AssistantTurnInput, VoiceTurnInput } from "@school-kit/types";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { currentPeriodStart } from "../../common/ai/ai.constants.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service.js";
import { AssistantWorkspaceService } from "../assistant-workspace/assistant-workspace.service.js";
import { AssistantOrchestratorService } from "../assistant-workspace/orchestrator/assistant-orchestrator.service.js";
import { ModelRoutingGate } from "../assistant-workspace/orchestrator/model-routing-gate.js";
import { StudentLookupService } from "../assistant-workspace/student-lookup.service.js";
import { BillingRunsService } from "../invoices/billing-runs.service.js";
import { InvoiceGenerationService } from "../invoices/invoice-generation.service.js";
import { deleteSchoolRows } from "../platform-admin/school-deletion.js";
import { ReminderCampaignsService } from "../reminder-campaigns/reminder-campaigns.service.js";
import type { ReminderSendPort } from "../reminder-campaigns/reminder-send.port.js";
import { StudentCorrectionsService } from "../student-corrections/student-corrections.service.js";
import { StudentIntakeService } from "../student-intake/student-intake.service.js";
import { StudentsService } from "../students/students.service.js";
import { TeacherScopeService } from "../teacher-scope/teacher-scope.service.js";
import { AssistantVoiceService } from "./assistant-voice.service.js";
import { readVoiceConfig, type VoiceConfig } from "./voice.config.js";
import { VoiceLedger } from "./voice-ledger.js";
import { VoiceProviderError, type VoiceCredentialRequest, type VoiceProviderPort, type VoiceSpeechRequest, type VoiceSpeechStream } from "./voice-provider.port.js";
import { SPOKEN_APPROVAL_REPLY } from "./voice-speech.js";

// SchoolKit Assistant voice against real PostgreSQL (RLS as app_user), the
// REAL orchestrator (detectors, redaction, ToolRegistry, budget, ledger,
// billing service), a SCRIPTED model port and a FAKE speech provider. No
// network and no paid call anywhere in this file.

// ---- Fakes -------------------------------------------------------------------

type Step = (Partial<AiConversationResult> & { stopReason: string | null }) | Error | (() => Promise<Partial<AiConversationResult> & { stopReason: string | null }>);

class ScriptedPort implements AnthropicPort {
  readonly requests: AiConversationRequest[] = [];
  constructor(private readonly script: Step[]) {}
  async create(_req: AiCallRequest): Promise<AiCallResult> {
    throw new Error("create() is not used by a conversation");
  }
  async converse(req: AiConversationRequest): Promise<AiConversationResult> {
    this.requests.push({ ...req, messages: [...req.messages] });
    let next = this.script.shift();
    if (!next) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    if (typeof next === "function") next = await next();
    const turn: AiAssistantTurn = Object.freeze({ kind: "ai-assistant-turn" as const });
    return { text: "", toolCalls: [], assistantTurn: turn, inputTokens: 120, outputTokens: 30, ...next };
  }
  seen(): string {
    return this.requests.flatMap((r) => r.messages.flatMap((m) => ("text" in m ? [m.text] : "toolResults" in m ? m.toolResults.map((t) => t.content) : []))).join("\n");
  }
}
let n = 0;
const tool = (name: string, input: Record<string, unknown>): AiToolCall => ({ id: `toolu_${++n}`, name, input });
const calls = (...c: AiToolCall[]): Step => ({ stopReason: "tool_use", toolCalls: c });
const answer = (text: string): Step => ({ stopReason: "end_turn", text });

class FakeVoiceProvider implements VoiceProviderPort {
  readonly name = "openai" as const;
  readonly mints: VoiceCredentialRequest[] = [];
  readonly spoken: string[] = [];
  failCredential = false;
  failSpeech = false;
  /** Stream one chunk and then wait until aborted (to observe barge-in). */
  holdSpeech = false;
  async mintCredential(req: VoiceCredentialRequest) {
    if (this.failCredential) throw new VoiceProviderError("credential", 503);
    this.mints.push(req);
    return { clientSecret: `ek_test_${this.mints.length}`, expiresAt: new Date(Date.now() + req.ttlSeconds * 1000), connectUrl: "https://voice.test/v1/realtime/calls", dataChannel: "oai-events" };
  }
  async synthesise(req: VoiceSpeechRequest): Promise<VoiceSpeechStream> {
    if (this.failSpeech) throw new VoiceProviderError("speech", 500);
    this.spoken.push(req.text);
    const hold = this.holdSpeech;
    async function* body() {
      yield new Uint8Array([0x49, 0x44, 0x33]);
      if (hold) {
        await new Promise<void>((resolve) => {
          if (req.signal.aborted) resolve();
          req.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }
      yield new Uint8Array([0x01, 0x02]);
    }
    return { contentType: "audio/mpeg", body: body() };
  }
}

// ---- Fixture -------------------------------------------------------------------

const ON = {
  "assistant-workspace": true, "assistant-model-routing": true, "assistant-voice": true, "assistant-billing": true,
  "reminder-campaigns": true, "student-intake": true, "student-corrections": true,
};
const schoolIds: string[] = [];
const sendPort = { send: async () => ({ status: "ACCEPTED", reason: null, channelUsed: "EMAIL", providerRef: null }) } as unknown as ReminderSendPort;

async function fixture(opts: { switches?: Record<string, boolean>; voiceBudget?: number | null; staff?: number } = {}) {
  const school = await basePrisma.school.create({
    data: {
      name: "Voice fixture", slug: `voice-${randomUUID()}`, status: "ACTIVE", aiEnabled: true, aiMonthlyTokenBudget: 1_000_000,
      featureSwitches: opts.switches ?? ON, voiceMonthlySecondsBudget: opts.voiceBudget === undefined ? null : opts.voiceBudget,
    },
  });
  schoolIds.push(school.id);
  return withTenant(school.id, async (db) => {
    const role = await db.role.create({
      data: { schoolId: school.id, key: "admin", name: "Admin", permissions: ["invoice.read", "invoice.issue", "finance.debtors.read", "finance.debtors.remind", "student.read", "student.update", "student.create"] },
    });
    const staff: AuthContext[] = [];
    for (let i = 0; i < (opts.staff ?? 3); i++) {
      const user = await db.user.create({ data: { schoolId: school.id, firstName: `Staff${i}`, lastName: "Member", isActive: true } });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      staff.push({ schoolId: school.id, userId: user.id, sessionId: `s${i}` } as AuthContext);
    }
    const year = await db.academicYear.create({ data: { schoolId: school.id, label: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") } });
    const first = await db.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "First Term", sequence: 1, isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2026-12-15") } });
    await db.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "Second Term", sequence: 2, isCurrent: false, startDate: new Date("2027-01-05"), endDate: new Date("2027-04-10") } });
    const jss2 = await db.classLevel.create({ data: { schoolId: school.id, name: "JSS 2", code: "jss2", orderIndex: 1, stage: "JSS" } });
    const arm = await db.classArm.create({ data: { schoolId: school.id, classLevelId: jss2.id, name: "JSS 2A", code: "2a" } });
    const student = await db.student.create({
      data: { schoolId: school.id, firstName: "Chidinma", lastName: "Okafor", admissionNumber: "ADM-701", dateOfBirth: new Date("2013-04-17"), gender: "FEMALE" },
    });
    await db.enrollment.create({ data: { schoolId: school.id, academicYearId: year.id, termId: first.id, classArmId: arm.id, studentId: student.id, status: "ENROLLED" } });
    const cat = await db.feeCategory.create({ data: { schoolId: school.id, name: "Tuition", createdBy: staff[0]!.userId } });
    await db.feeItem.create({ data: { schoolId: school.id, categoryId: cat.id, name: "Tuition", amount: 4_000_000, createdBy: staff[0]!.userId } });
    return { schoolId: school.id, staff, auth: staff[0]!, firstTermId: first.id };
  }, { timeoutMs: 30_000 });
}

function build(port: AnthropicPort, provider: VoiceProviderPort | null, overrides: Partial<VoiceConfig> = {}, env: Record<string, string> = {}) {
  const features = new FeatureSwitchesService(new ConfigService(env));
  const ai = new AiGenerationService(new ConfigService(env), port);
  const workspace = new AssistantWorkspaceService(features, new ModelRoutingGate(ai, features));
  const billing = new BillingRunsService(new InvoiceGenerationService(), features, ai);
  const lookup = new StudentLookupService(new StudentsService(), new TeacherScopeService());
  const orchestrator = new AssistantOrchestratorService(
    ai, workspace, billing, new ReminderCampaignsService(features, sendPort), new StudentIntakeService(features), new StudentCorrectionsService(features), lookup,
  );
  const config: VoiceConfig = { ...readVoiceConfig({}), provider: "openai", apiKey: "sk-test", ...overrides };
  const ledger = new VoiceLedger(config);
  const clock = { offset: 0 };
  ledger.now = () => Date.now() + clock.offset;
  const voice = new AssistantVoiceService(config, ledger, features, workspace, orchestrator, provider);
  return { voice, billing, features, clock, ledger };
}

const say = (text: string, earlier: AssistantTurnInput["messages"] = []): AssistantTurnInput => ({ messages: [...earlier, { role: "user", text }], tasks: [], students: [] });
const voiceTurn = (text: string, mode: "voice" | "text" = "voice", turnId = randomUUID()): VoiceTurnInput => ({ turnId, inputMode: mode, turn: say(text) });
const row = (schoolId: string, id: string) => withTenant(schoolId, (db) => db.assistantVoiceSession.findFirstOrThrow({ where: { id } }));
const invoiceCount = (id: string) => withTenant(id, (db) => db.invoice.count({ where: { schoolId: id } }));
const code = (p: Promise<unknown>) => p.then(() => "resolved", (e: { code?: string }) => e.code ?? String(e));
const drain = async (body: AsyncIterable<Uint8Array>) => {
  const out: number[] = [];
  for await (const c of body) out.push(...c);
  return out;
};

describe("SchoolKit Assistant voice (PostgreSQL, real orchestrator, scripted model, fake speech provider)", () => {
  let fx: Awaited<ReturnType<typeof fixture>>;
  let logged: string[];
  beforeEach(async () => {
    fx = await fixture();
    logged = [];
    for (const level of ["log", "warn", "error", "debug"] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((m: unknown) => { logged.push(String(m)); });
    }
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
      await deleteSchoolRows(tx, id);
    }, { timeout: 60_000 });
  });

  // ---- Off by default, fail closed ----------------------------------------------------

  it("is off by default: a school with the Assistant on but no voice switch cannot start voice", async () => {
    const off = await fixture({ switches: { ...ON, "assistant-voice": false } });
    const { voice } = build(new ScriptedPort([]), new FakeVoiceProvider());
    const caps = await voice.capabilities(off.auth);
    expect(caps).toMatchObject({ available: false, blockers: ["SWITCH_OFF"], contractVersion: 1, transports: ["webrtc"] });
    await expect(code(voice.start(off.auth, { activation: "user-gesture" }))).resolves.toBe("VOICE_UNAVAILABLE");
    expect(await withTenant(off.schoolId, (db) => db.assistantVoiceSession.count())).toBe(0);
  });

  it("fails closed with no provider configured, and depends on the model-backed assistant", async () => {
    const { voice } = build(new ScriptedPort([]), null);
    expect((await voice.capabilities(fx.auth)).blockers).toEqual(["PROVIDER_NOT_CONFIGURED"]);
    await expect(code(voice.start(fx.auth, { activation: "user-gesture" }))).resolves.toBe("VOICE_UNAVAILABLE");

    const noModel = await fixture({ switches: { ...ON, "assistant-model-routing": false } });
    expect((await build(new ScriptedPort([]), new FakeVoiceProvider()).voice.capabilities(noModel.auth)).blockers).toEqual(["MODEL_ROUTING_UNAVAILABLE"]);
    const noPanel = await fixture({ switches: { ...ON, "assistant-workspace": false } });
    expect((await build(new ScriptedPort([]), new FakeVoiceProvider()).voice.capabilities(noPanel.auth)).blockers).toEqual(["WORKSPACE_OFF", "MODEL_ROUTING_UNAVAILABLE"]);
    // The platform kill beats the school's switch.
    const killed = build(new ScriptedPort([]), new FakeVoiceProvider(), {}, { FEATURES_DISABLED: "assistant-voice" });
    expect((await killed.voice.capabilities(fx.auth)).blockers).toEqual(["SWITCH_OFF"]);
  });

  it("refuses to start when the school's AI allowance is used up", async () => {
    await withTenant(fx.schoolId, (db) => db.aIBudgetPeriod.create({ data: { schoolId: fx.schoolId, periodStart: currentPeriodStart(), tokensReserved: 1_000_000 } }));
    const { voice } = build(new ScriptedPort([]), new FakeVoiceProvider());
    expect((await voice.capabilities(fx.auth)).blockers).toEqual(["AI_BUDGET_EXHAUSTED"]);
    await expect(code(voice.start(fx.auth, { activation: "user-gesture" }))).resolves.toBe("VOICE_BUDGET_EXHAUSTED");
  });

  // ---- The shared assistant ------------------------------------------------------------------

  it("a spoken request runs the chat's own turn: a preview is prepared, nothing is issued, the reply is spoken, and no content is stored or logged", async () => {
    const provider = new FakeVoiceProvider();
    const port = new ScriptedPort([
      calls(tool("prepare_invoices", { task: "new", term: "second", classes: ["JSS2"] })),
      answer("The preview for JSS 2 is ready in the card."),
    ]);
    const { voice, billing } = build(port, provider);
    const started = await voice.start(fx.auth, { activation: "user-gesture" });
    expect(started.credential).toMatchObject({ provider: "openai", transport: "webrtc", clientSecret: "ek_test_1", dataChannel: "oai-events", language: "en" });
    expect(provider.mints[0]!.ttlSeconds).toBeLessThanOrEqual(60);
    expect(provider.mints[0]!.vocabularyPrompt).not.toMatch(/Chidinma|Okafor|ADM-/);
    expect(started.session).toMatchObject({ status: "ACTIVE", endReason: null });

    const transcript = "Prepare second term invoices for JSS 2";
    const r = await voice.turn(fx.auth, started.session.sessionId, voiceTurn(transcript));
    expect(r.turn.outcome).toBe("answered");
    expect(r.turn.toolsUsed).toEqual(["prepare_invoices"]);
    const action = r.turn.actions[0]!;
    expect(action).toMatchObject({ kind: "invoices", handle: "t1", problem: null });
    expect(r.approvalRequiresCard).toBe(true);
    expect(r.spokenApprovalDeflected).toBe(false);
    expect(r.speech!.text).toMatch(/preview for JSS 2 is ready.*tap Approve there/);
    // The model got the same system prompt and tool set as chat.
    expect(port.requests[0]!.tools!.map((t) => t.name)).toContain("prepare_invoices");
    expect(port.requests[0]!.tools!.map((t) => t.name).some((t) => /approve|confirm|issue|execute/.test(t))).toBe(false);
    expect(await invoiceCount(fx.schoolId)).toBe(0);

    // Speaking the server's reply.
    const audio = await voice.speech(fx.auth, started.session.sessionId, { turnId: r.turnId, token: r.speech!.token, text: r.speech!.text }, new AbortController().signal);
    expect(await drain(audio.body)).toEqual([0x49, 0x44, 0x33, 0x01, 0x02]);
    expect(provider.spoken).toEqual([r.speech!.text]);

    // Approval is still the card's, on the server's preview.
    const run = await billing.get(fx.auth, (action as { runId: string }).runId);
    expect(run.status).toBe("PENDING");

    const ended = await voice.end(fx.auth, started.session.sessionId);
    expect(ended).toMatchObject({ status: "ENDED", endReason: "USER_ENDED" });
    const stored = await row(fx.schoolId, started.session.sessionId);
    expect(stored).toMatchObject({ turnCount: 1, speechCharacters: r.speech!.text.length, credentialCount: 1 });
    // Nothing in the row or the logs carries the transcript, the reply or the credential.
    const everything = JSON.stringify(stored) + logged.join("\n");
    for (const secret of [transcript, "preview for JSS 2", "ek_test_1", "Chidinma"]) expect(everything).not.toContain(secret);
  });

  it("a roster name spoken in a request is replaced before the model, exactly as in chat", async () => {
    const port = new ScriptedPort([answer("I can look that student up for you.")]);
    const { voice } = build(port, new FakeVoiceProvider());
    const s = await voice.start(fx.auth, { activation: "user-gesture" });
    await voice.turn(fx.auth, s.session.sessionId, voiceTurn("show me Chidinma Okafor's attendance"));
    expect(port.seen()).not.toMatch(/Chidinma|Okafor/);
    expect(port.seen()).toMatch(/⟨P1⟩/);
  });

  it("a spoken 'yes, approve it' approves nothing and calls no model; the same words typed go to the assistant as in chat", async () => {
    const port = new ScriptedPort([
      calls(tool("prepare_invoices", { task: "new", term: "second", classes: ["JSS2"] })),
      answer("The preview is ready."),
    ]);
    const { voice, billing } = build(port, new FakeVoiceProvider());
    const s = await voice.start(fx.auth, { activation: "user-gesture" });
    const r1 = await voice.turn(fx.auth, s.session.sessionId, voiceTurn("Prepare second term invoices for JSS 2"));
    const runId = (r1.turn.actions[0] as { runId: string }).runId;
    const before = port.requests.length;

    for (const words of ["yes", "Yes, approve it.", "go ahead and send them", "confirm"]) {
      const r = await voice.turn(fx.auth, s.session.sessionId, voiceTurn(words));
      expect(r.spokenApprovalDeflected).toBe(true);
      expect(r.turn).toEqual({ outcome: "answered", reply: SPOKEN_APPROVAL_REPLY, actions: [], blockedCategories: [], toolsUsed: [] });
      expect(r.speech!.text).toBe(SPOKEN_APPROVAL_REPLY);
    }
    expect(port.requests.length).toBe(before);
    expect((await billing.get(fx.auth, runId)).status).toBe("PENDING");
    expect(await invoiceCount(fx.schoolId)).toBe(0);

    // Typed during a voice session: chat behaviour, unchanged.
    const typed = new ScriptedPort([answer("Please use the Approve button on the card.")]);
    const t = build(typed, new FakeVoiceProvider());
    const s2 = await t.voice.start(fx.staff[1]!, { activation: "user-gesture" });
    const r = await t.voice.turn(fx.staff[1]!, s2.session.sessionId, voiceTurn("yes", "text"));
    expect(r.spokenApprovalDeflected).toBe(false);
    expect(typed.requests.length).toBe(1);
    expect(await invoiceCount(fx.schoolId)).toBe(0);
  });

  it("refuses a replayed turn id; the model runs once", async () => {
    const port = new ScriptedPort([answer("Hello.")]);
    const { voice } = build(port, new FakeVoiceProvider());
    const s = await voice.start(fx.auth, { activation: "user-gesture" });
    const t = voiceTurn("hello there");
    await voice.turn(fx.auth, s.session.sessionId, t);
    await expect(code(voice.turn(fx.auth, s.session.sessionId, t))).resolves.toBe("VOICE_TURN_REPLAYED");
    await expect(Promise.all([voice.turn(fx.auth, s.session.sessionId, t), voice.turn(fx.auth, s.session.sessionId, t)]).catch((e) => e.code)).resolves.toBe("VOICE_TURN_REPLAYED");
    expect(port.requests.length).toBe(1);
  });

  // ---- Tenancy and identity ----------------------------------------------------------------

  it("a session is reachable only by its own person at its own school", async () => {
    const other = await fixture();
    const { voice } = build(new ScriptedPort([answer("x")]), new FakeVoiceProvider());
    const s = await voice.start(fx.auth, { activation: "user-gesture" });
    const id = s.session.sessionId;
    // Same school, another member of staff.
    for (const call of [
      () => voice.get(fx.staff[1]!, id), () => voice.turn(fx.staff[1]!, id, voiceTurn("hi")), () => voice.heartbeat(fx.staff[1]!, id),
      () => voice.end(fx.staff[1]!, id), () => voice.credentials(fx.staff[1]!, id), () => voice.interrupt(fx.staff[1]!, id, { at: "speaking" }),
    ]) await expect(code(call())).resolves.toBe("NOT_FOUND");
    // Another school (its own valid user), and a forged auth context pointing at this school's user from there.
    await expect(code(voice.get(other.auth, id))).resolves.toBe("NOT_FOUND");
    await expect(code(voice.turn({ ...other.auth, userId: fx.auth.userId }, id, voiceTurn("hi")))).resolves.toBe("NOT_FOUND");
    await expect(code(voice.get(fx.auth, "not-a-uuid"))).resolves.toBe("NOT_FOUND");
    // RLS: the other school's GUC sees no row at all.
    expect(await withTenant(other.schoolId, (db) => db.assistantVoiceSession.count({ where: { id } }))).toBe(0);
    expect((await voice.get(fx.auth, id)).status).toBe("ACTIVE");
  });

  // ---- Revocation, expiry, idle --------------------------------------------------------------

  it("ends the session when the person is deactivated mid-session", async () => {
    const { voice } = build(new ScriptedPort([]), new FakeVoiceProvider());
    const s = await voice.start(fx.auth, { activation: "user-gesture" });
    await withTenant(fx.schoolId, (db) => db.user.update({ where: { id: fx.auth.userId }, data: { isActive: false } }));
    await expect(code(voice.turn(fx.auth, s.session.sessionId, voiceTurn("hello")))).resolves.toBe("USER_INACTIVE");
    expect(await row(fx.schoolId, s.session.sessionId)).toMatchObject({ status: "ENDED", endReason: "REVOKED" });
  });

  it("ends the session when the school's voice or model switch is turned off mid-session, or permissions are removed", async () => {
    for (const change of ["voice", "routing", "permissions"] as const) {
      const f = await fixture();
      const { voice, features } = build(new ScriptedPort([]), new FakeVoiceProvider());
      const s = await voice.start(f.auth, { activation: "user-gesture" });
      if (change === "permissions") {
        await withTenant(f.schoolId, (db) => db.userRole.deleteMany({ where: { userId: f.auth.userId } }));
        // With no role the person can still use the panel (any staff), so voice stays: permissions gate each WORKFLOW, re-checked by the chat's own tools.
        const r = await voice.heartbeat(f.auth, s.session.sessionId);
        expect(r.status).toBe("ACTIVE");
        continue;
      }
      const key = change === "voice" ? "assistant-voice" : "assistant-model-routing";
      await basePrisma.school.update({ where: { id: f.schoolId }, data: { featureSwitches: { ...ON, [key]: false } } });
      features.invalidate(f.schoolId);
      const err = await voice.heartbeat(f.auth, s.session.sessionId).catch((e) => e);
      expect(err.code).toBe("VOICE_UNAVAILABLE");
      expect(err.details.endReason).toBe("REVOKED");
      expect(await row(f.schoolId, s.session.sessionId)).toMatchObject({ status: "ENDED", endReason: "REVOKED" });
      await expect(code(voice.turn(f.auth, s.session.sessionId, voiceTurn("hi")))).resolves.toBe("VOICE_SESSION_ENDED");
    }
  });

  it("idles out and expires, billing only up to the idle limit or the expiry", async () => {
    const { voice, clock } = build(new ScriptedPort([]), new FakeVoiceProvider(), { idleTimeoutSeconds: 60, maxSessionSeconds: 300 });
    const a = await voice.start(fx.auth, { activation: "user-gesture" });
    clock.offset = 20_000;
    await voice.heartbeat(fx.auth, a.session.sessionId);
    clock.offset = 20_000 + 61_000;
    const err = await voice.heartbeat(fx.auth, a.session.sessionId).catch((e) => e);
    expect(err.code).toBe("VOICE_SESSION_ENDED");
    expect(err.details.endReason).toBe("IDLE");
    const idled = await row(fx.schoolId, a.session.sessionId);
    expect(idled.billedSeconds).toBeGreaterThanOrEqual(79);
    expect(idled.billedSeconds).toBeLessThanOrEqual(81);

    clock.offset = 0;
    const b = await voice.start(fx.staff[1]!, { activation: "user-gesture" });
    expect(new Date(b.session.expiresAt).getTime() - new Date(b.session.startedAt).getTime()).toBe(300_000);
    for (let t = 50; t <= 300; t += 50) {
      clock.offset = t * 1000 - 1000;
      await voice.heartbeat(fx.staff[1]!, b.session.sessionId);
    }
    clock.offset = 301_000;
    expect((await voice.get(fx.staff[1]!, b.session.sessionId))).toMatchObject({ status: "ENDED", endReason: "EXPIRED" });
    expect((await row(fx.schoolId, b.session.sessionId)).billedSeconds).toBe(300);
  });

  // ---- Concurrency and budget -------------------------------------------------------------------

  it("one live session per person (a new one supersedes), and a per-school cap", async () => {
    const provider = new FakeVoiceProvider();
    const { voice } = build(new ScriptedPort([]), provider, { maxConcurrentPerSchool: 2 });
    const first = await voice.start(fx.auth, { activation: "user-gesture" });
    const again = await voice.start(fx.auth, { activation: "user-gesture" });
    expect(await row(fx.schoolId, first.session.sessionId)).toMatchObject({ status: "ENDED", endReason: "SUPERSEDED" });
    await expect(code(voice.heartbeat(fx.auth, first.session.sessionId))).resolves.toBe("VOICE_SESSION_ENDED");
    await voice.start(fx.staff[1]!, { activation: "user-gesture" });
    await expect(code(voice.start(fx.staff[2]!, { activation: "user-gesture" }))).resolves.toBe("VOICE_CONCURRENCY_LIMIT");
    await voice.end(fx.auth, again.session.sessionId);
    await expect(voice.start(fx.staff[2]!, { activation: "user-gesture" })).resolves.toBeTruthy();
    // Simultaneous starts by different people cannot pass the cap together.
    const g = await fixture({ staff: 3 });
    const results = await Promise.allSettled(g.staff.map((st) => voice.start(st, { activation: "user-gesture" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await withTenant(g.schoolId, (db) => db.assistantVoiceSession.count({ where: { status: "ACTIVE" } }))).toBe(2);
  });

  it("reserves the school's monthly seconds, so sessions cannot jointly overspend; usage is settled at the end", async () => {
    const f = await fixture({ voiceBudget: 400 });
    const { voice, clock } = build(new ScriptedPort([]), new FakeVoiceProvider(), { maxSessionSeconds: 300 });
    const a = await voice.start(f.staff[0]!, { activation: "user-gesture" });
    expect(a.session.usage.secondsRemaining).toBeGreaterThanOrEqual(299);
    const b = await voice.start(f.staff[1]!, { activation: "user-gesture" });
    // Only 100 seconds were left to reserve.
    expect(new Date(b.session.expiresAt).getTime() - new Date(b.session.startedAt).getTime()).toBe(100_000);
    await expect(code(voice.start(f.staff[2]!, { activation: "user-gesture" }))).resolves.toBe("VOICE_BUDGET_EXHAUSTED");
    expect((await voice.capabilities(f.staff[2]!)).blockers).toEqual(["VOICE_BUDGET_EXHAUSTED"]);

    clock.offset = 40_000;
    await voice.end(f.staff[0]!, a.session.sessionId);
    const settled = await row(f.schoolId, a.session.sessionId);
    expect(settled.billedSeconds).toBe(40);
    expect(settled.estimatedCostMicroUsd).toBe(40 * 100);
    // 400 - 40 settled - 100 reserved by b = 260 left.
    const caps = await voice.capabilities(f.staff[2]!);
    expect(caps.usage.secondsRemainingThisMonth).toBe(260);
    expect(caps.available).toBe(true);

    const zero = await fixture({ voiceBudget: 0 });
    expect((await voice.capabilities(zero.auth)).blockers).toEqual(["VOICE_BUDGET_EXHAUSTED"]);
  });

  it("caps reconnect credentials per session", async () => {
    const provider = new FakeVoiceProvider();
    const { voice } = build(new ScriptedPort([]), provider, { maxCredentialsPerSession: 3 });
    const s = await voice.start(fx.auth, { activation: "user-gesture" });
    expect((await voice.credentials(fx.auth, s.session.sessionId)).credential.clientSecret).toBe("ek_test_2");
    await voice.credentials(fx.auth, s.session.sessionId);
    await expect(code(voice.credentials(fx.auth, s.session.sessionId))).resolves.toBe("VOICE_CREDENTIAL_LIMIT");
    expect(provider.mints).toHaveLength(3);
  });

  // ---- Speech --------------------------------------------------------------------------------

  it("speaks only server-written text, within the session's character allowance, and refunds a failed synthesis", async () => {
    const provider = new FakeVoiceProvider();
    const { voice } = build(new ScriptedPort([answer("Short reply."), answer("Another reply that is a little longer.")]), provider, { maxSpeechCharsPerSession: 120 });
    const s = await voice.start(fx.auth, { activation: "user-gesture" });
    const r = await voice.turn(fx.auth, s.session.sessionId, voiceTurn("hello"));
    const sig = new AbortController().signal;
    await expect(code(voice.speech(fx.auth, s.session.sessionId, { turnId: r.turnId, token: r.speech!.token, text: "Your invoices were approved." }, sig))).resolves.toBe("VOICE_SPEECH_TOKEN_INVALID");
    await expect(code(voice.speech(fx.auth, s.session.sessionId, { turnId: randomUUID(), token: r.speech!.token, text: r.speech!.text }, sig))).resolves.toBe("VOICE_SPEECH_TOKEN_INVALID");
    // Another person cannot use this session's token.
    await expect(code(voice.speech(fx.staff[1]!, s.session.sessionId, { turnId: r.turnId, token: r.speech!.token, text: r.speech!.text }, sig))).resolves.toBe("NOT_FOUND");
    expect(provider.spoken).toEqual([]);

    provider.failSpeech = true;
    await expect(code(voice.speech(fx.auth, s.session.sessionId, { turnId: r.turnId, token: r.speech!.token, text: r.speech!.text }, sig))).resolves.toBe("VOICE_PROVIDER_FAILED");
    expect((await row(fx.schoolId, s.session.sessionId)).speechCharacters).toBe(0);
    provider.failSpeech = false;

    for (let i = 0; i < 10; i++) await drain((await voice.speech(fx.auth, s.session.sessionId, { turnId: r.turnId, token: r.speech!.token, text: r.speech!.text }, sig)).body);
    await expect(code(voice.speech(fx.auth, s.session.sessionId, { turnId: r.turnId, token: r.speech!.token, text: r.speech!.text }, sig))).resolves.toBe("VOICE_SPEECH_LIMIT");
    expect((await row(fx.schoolId, s.session.sessionId)).speechCharacters).toBe(r.speech!.text.length * 10);
  });

  it("barge-in: interrupting stops the speech stream at once", async () => {
    const provider = new FakeVoiceProvider();
    provider.holdSpeech = true;
    const { voice } = build(new ScriptedPort([answer("A long explanation that the person will talk over.")]), provider);
    const s = await voice.start(fx.auth, { activation: "user-gesture" });
    const r = await voice.turn(fx.auth, s.session.sessionId, voiceTurn("explain fee reminders"));
    const audio = await voice.speech(fx.auth, s.session.sessionId, { turnId: r.turnId, token: r.speech!.token, text: r.speech!.text }, new AbortController().signal);
    const it = audio.body[Symbol.asyncIterator]();
    expect((await it.next()).value).toEqual(new Uint8Array([0x49, 0x44, 0x33]));
    expect(voice.activeSpeechStreams(s.session.sessionId)).toBe(1);
    const pending = it.next();
    const after = await voice.interrupt(fx.auth, s.session.sessionId, { turnId: r.turnId, at: "speaking" });
    expect((await pending).done).toBe(true);
    expect(voice.activeSpeechStreams(s.session.sessionId)).toBe(0);
    expect(after.usage.interruptions).toBe(1);

    // The browser aborting its request (its own barge-in) ends the stream the same way.
    const ac = new AbortController();
    const audio2 = await voice.speech(fx.auth, s.session.sessionId, { turnId: r.turnId, token: r.speech!.token, text: r.speech!.text }, ac.signal);
    const it2 = audio2.body[Symbol.asyncIterator]();
    await it2.next();
    const p2 = it2.next();
    ac.abort();
    expect((await p2).done).toBe(true);
  });

  it("interrupting while the assistant is thinking discards the turn's speech (its cards are previews only)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const port = new ScriptedPort([async () => { await gate; return { stopReason: "end_turn", text: "Here is the answer." }; }]);
    const { voice } = build(port, new FakeVoiceProvider());
    const s = await voice.start(fx.auth, { activation: "user-gesture" });
    const t = voiceTurn("how do reminders work");
    const pending = voice.turn(fx.auth, s.session.sessionId, t);
    while (port.requests.length === 0) await new Promise((r) => setTimeout(r, 10));
    await voice.interrupt(fx.auth, s.session.sessionId, { turnId: t.turnId, at: "thinking" });
    release();
    const r = await pending;
    expect(r.interrupted).toBe(true);
    expect(r.speech).toBeNull();
    expect(r.turn.outcome).toBe("answered");
  });

  // ---- Provider failure and end ----------------------------------------------------------------

  it("a provider failure at start ends the session unbilled and reports it, without faking audio", async () => {
    const provider = new FakeVoiceProvider();
    provider.failCredential = true;
    const { voice } = build(new ScriptedPort([]), provider);
    await expect(code(voice.start(fx.auth, { activation: "user-gesture" }))).resolves.toBe("VOICE_PROVIDER_FAILED");
    const rows = await withTenant(fx.schoolId, (db) => db.assistantVoiceSession.findMany({ where: { schoolId: fx.schoolId } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "ENDED", endReason: "PROVIDER_FAILED", billedSeconds: 0 });
    // A failing reconnect is reported the same way; the session stays (the browser may retry within its cap).
    provider.failCredential = false;
    const s = await voice.start(fx.auth, { activation: "user-gesture" });
    provider.failCredential = true;
    await expect(code(voice.credentials(fx.auth, s.session.sessionId))).resolves.toBe("VOICE_PROVIDER_FAILED");
    expect((await voice.get(fx.auth, s.session.sessionId)).status).toBe("ACTIVE");
  });

  it("end is idempotent and a platform-admin end-all stops every live session", async () => {
    const { voice, ledger } = build(new ScriptedPort([]), new FakeVoiceProvider());
    const a = await voice.start(fx.staff[0]!, { activation: "user-gesture" });
    const b = await voice.start(fx.staff[1]!, { activation: "user-gesture" });
    await voice.end(fx.staff[0]!, a.session.sessionId);
    expect((await voice.end(fx.staff[0]!, a.session.sessionId)).endReason).toBe("USER_ENDED");
    expect(await ledger.endAll(fx.schoolId, "ADMIN_ENDED")).toBe(1);
    expect(await row(fx.schoolId, b.session.sessionId)).toMatchObject({ status: "ENDED", endReason: "ADMIN_ENDED" });
    await expect(code(voice.turn(fx.staff[1]!, b.session.sessionId, voiceTurn("hi")))).resolves.toBe("VOICE_SESSION_ENDED");
  });
});
