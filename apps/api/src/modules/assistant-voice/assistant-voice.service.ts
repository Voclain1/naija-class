import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  UpstreamError,
  VOICE_BLOCKER_TEXT,
  VOICE_CONTRACT_VERSION,
  VOICE_ERROR_CODES,
  type AssistantCapabilitiesDto,
  type AssistantTurnDto,
  type VoiceBlocker,
  type VoiceCapabilitiesDto,
  type VoiceCredentialDto,
  type VoiceEndReason,
  type VoiceInterruptInput,
  type VoiceSessionCreateInput,
  type VoiceSessionDto,
  type VoiceSessionStartDto,
  type VoiceSpeechInput,
  type VoiceTurnDto,
  type VoiceTurnInput,
} from "@school-kit/types";

import { loadProviderEgressGuard } from "../../common/ai/pii/provider-egress-guard.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service.js";
import { AssistantWorkspaceService } from "../assistant-workspace/assistant-workspace.service.js";
import { AssistantOrchestratorService } from "../assistant-workspace/orchestrator/assistant-orchestrator.service.js";
import { VOICE_CONFIG, type VoiceConfig } from "./voice.config.js";
import { BUDGET_BLOCKERS, REVOKING_BLOCKERS, voiceApproval, voiceBlockers } from "./voice-gate.js";
import { VoiceLedger, type VoiceSessionRow } from "./voice-ledger.js";
import { VOICE_PROVIDER, VOICE_VOCABULARY_PROMPT, VoiceProviderError, type VoiceProviderPort, type VoiceSpeechStream } from "./voice-provider.port.js";
import { SPOKEN_APPROVAL_REPLY, actionsNeedCardApproval, isSpokenApproval, signSpeech, speakableReply, verifySpeech } from "./voice-speech.js";

// ---------------------------------------------------------------------------
// SchoolKit Assistant voice sessions (docs/modules/assistant-voice.md).
//
// A voice session is a short-lived, metered permission for ONE signed-in
// staff member to talk to the SAME assistant the chat uses. Every request:
//   * takes school and user from the session (AuthContext), never the body;
//   * re-reads the person and every switch (AssistantWorkspaceService
//     .capabilities, the chat's own rule), and ENDS the session (REVOKED) when
//     anything that allowed it has gone;
//   * finds the session only by (id, school, user): another person's or
//     another school's id is "not found", indistinguishable from unknown.
//
// Turns go through AssistantOrchestratorService.turn UNCHANGED: detectors,
// roster-name redaction, the scoped ToolRegistry, the AI budget and the
// ledger are the chat's. Voice adds no tool and no approval: a spoken "yes"
// is answered with "tap Approve on the card" and runs nothing.
//
// HOLDS NO CONTENT. Transcripts and replies pass through memory for one
// request; nothing here stores, queues or logs them. Logs carry ids, counts
// and outcome names only.
// ---------------------------------------------------------------------------

interface InFlightTurn {
  turnId: string;
  interrupted: boolean;
}

@Injectable()
export class AssistantVoiceService {
  private readonly logger = new Logger(AssistantVoiceService.name);
  /** In-process only: barge-in reaches requests this process is serving. The browser also aborts its own fetches. */
  private readonly inFlight = new Map<string, InFlightTurn>();
  private readonly speaking = new Map<string, Set<AbortController>>();

  constructor(
    @Inject(VOICE_CONFIG) private readonly config: VoiceConfig,
    readonly ledger: VoiceLedger,
    private readonly features: FeatureSwitchesService,
    private readonly workspace: AssistantWorkspaceService,
    private readonly orchestrator: AssistantOrchestratorService,
    @Optional() @Inject(VOICE_PROVIDER) private readonly provider: VoiceProviderPort | null = null,
  ) {}

  private nowDate(): Date {
    return new Date(this.ledger.now());
  }

  // ---- Capabilities and the gate ---------------------------------------------

  async capabilities(auth: AuthContext): Promise<VoiceCapabilitiesDto> {
    const { blockers, usage } = await this.evaluate(auth);
    return {
      contractVersion: VOICE_CONTRACT_VERSION,
      available: blockers.length === 0,
      blockers,
      transports: ["webrtc"],
      provider: this.provider ? this.provider.name : null,
      limits: this.ledger.limits(),
      usage: {
        monthlySecondsBudget: usage.budgetSeconds,
        secondsUsedThisMonth: usage.usedSeconds,
        secondsRemainingThisMonth: usage.remainingSeconds,
      },
    };
  }

  /** The person now (throws USER_INACTIVE), every switch, and the school's allowances. */
  private async evaluate(auth: AuthContext): Promise<{ blockers: VoiceBlocker[]; caps: AssistantCapabilitiesDto; usage: Awaited<ReturnType<VoiceLedger["monthUsage"]>> }> {
    const caps = await this.workspace.capabilities(auth);
    const switchOn = await this.features.isOn(auth.schoolId, "assistant-voice");
    const { usage, aiExhausted } = await withTenant(auth.schoolId, async (db) => {
      await this.ledger.sweep(db, auth.schoolId);
      return { usage: await this.ledger.monthUsage(db, auth.schoolId), aiExhausted: await this.ledger.aiBudgetExhausted(db, auth.schoolId) };
    }, { label: "assistant-voice-evaluate" });
    const blockers = voiceBlockers({
      switchOn,
      workspaceWorking: caps.enabled,
      modelRoutingWorking: caps.enabled && caps.modelRouting.available,
      approvalBlocking: voiceApproval().blocking,
      providerConfigured: this.provider !== null,
      voiceSecondsRemaining: usage.remainingSeconds,
      minSessionSeconds: this.config.minSessionSeconds,
      aiBudgetExhausted: aiExhausted,
    });
    return { blockers, caps, usage };
  }

  private refuse(blockers: VoiceBlocker[]): never {
    const first = blockers[0]!;
    if (blockers.every((b) => BUDGET_BLOCKERS.has(b))) {
      throw new RateLimitError(VOICE_ERROR_CODES.BUDGET_EXHAUSTED, VOICE_BLOCKER_TEXT[first], { blockers });
    }
    throw new ForbiddenError(VOICE_ERROR_CODES.UNAVAILABLE, VOICE_BLOCKER_TEXT[first], { blockers });
  }

  // ---- Start ---------------------------------------------------------------------

  async start(auth: AuthContext, _input: VoiceSessionCreateInput): Promise<VoiceSessionStartDto> {
    const { blockers } = await this.evaluate(auth);
    if (blockers.length > 0) this.refuse(blockers);
    const provider = this.provider!;

    const row = await withTenant(auth.schoolId, async (db) => {
      // One writer per school at a time, so the concurrency cap and the
      // minutes reservation cannot be raced by two simultaneous starts.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assistant-voice:${auth.schoolId}`}))`;
      await this.ledger.sweep(db, auth.schoolId);
      // One live session per person: a new tab or a reload supersedes the old one.
      for (const old of await db.assistantVoiceSession.findMany({ where: { schoolId: auth.schoolId, userId: auth.userId, status: "ACTIVE" } })) {
        await this.ledger.finalise(db, old, "SUPERSEDED");
        this.abortSpeech(old.id);
      }
      const active = await db.assistantVoiceSession.count({ where: { schoolId: auth.schoolId, status: "ACTIVE" } });
      if (active >= this.config.maxConcurrentPerSchool) {
        throw new RateLimitError(VOICE_ERROR_CODES.CONCURRENCY_LIMIT, "Too many voice sessions are open at your school right now. Try again shortly, or keep typing.");
      }
      const usage = await this.ledger.monthUsage(db, auth.schoolId);
      const allowance = Math.min(this.config.maxSessionSeconds, usage.remainingSeconds);
      if (allowance < this.config.minSessionSeconds) {
        throw new RateLimitError(VOICE_ERROR_CODES.BUDGET_EXHAUSTED, VOICE_BLOCKER_TEXT.VOICE_BUDGET_EXHAUSTED, { blockers: ["VOICE_BUDGET_EXHAUSTED"] });
      }
      const now = this.nowDate();
      return db.assistantVoiceSession.create({
        data: {
          schoolId: auth.schoolId,
          userId: auth.userId,
          provider: provider.name,
          startedAt: now,
          lastActivityAt: now,
          expiresAt: new Date(now.getTime() + allowance * 1000),
          credentialCount: 1,
        },
      });
    }, { label: "assistant-voice-start" });

    let credential: VoiceCredentialDto;
    try {
      credential = await this.mint(row);
    } catch (e) {
      await withTenant(auth.schoolId, (db) => this.ledger.finalise(db, row, "PROVIDER_FAILED"));
      throw e;
    }
    this.logger.log(`Voice session started: school=${auth.schoolId} session=${row.id}`);
    return { session: this.ledger.toDto(row), credential, limits: this.ledger.limits() };
  }

  private async mint(row: VoiceSessionRow): Promise<VoiceCredentialDto> {
    const provider = this.provider;
    if (!provider) throw new ForbiddenError(VOICE_ERROR_CODES.UNAVAILABLE, VOICE_BLOCKER_TEXT.PROVIDER_NOT_CONFIGURED, { blockers: ["PROVIDER_NOT_CONFIGURED"] });
    const remaining = Math.floor((row.expiresAt.getTime() - this.ledger.now()) / 1000);
    try {
      const c = await provider.mintCredential({
        ttlSeconds: Math.max(10, Math.min(this.config.credentialTtlSeconds, remaining)),
        transcriptionModel: this.config.transcriptionModel,
        language: this.config.language,
        vocabularyPrompt: VOICE_VOCABULARY_PROMPT,
        turnDetection: { type: this.config.turnDetection, silenceMs: this.config.silenceMs },
      });
      return {
        provider: provider.name,
        transport: "webrtc",
        clientSecret: c.clientSecret,
        expiresAt: c.expiresAt.toISOString(),
        connectUrl: c.connectUrl,
        dataChannel: c.dataChannel,
        transcriptionModel: this.config.transcriptionModel,
        turnDetection: { type: this.config.turnDetection, silenceMs: this.config.turnDetection === "server_vad" ? this.config.silenceMs : null },
        language: this.config.language,
      };
    } catch (e) {
      if (e instanceof VoiceProviderError) {
        this.logger.warn(`Voice credential failed: session=${row.id} status=${e.status ?? "none"}`);
        throw new UpstreamError(VOICE_ERROR_CODES.PROVIDER_FAILED, "The voice service is unavailable right now. You can keep typing.");
      }
      throw e;
    }
  }

  // ---- The live-session guard -------------------------------------------------------

  /**
   * The session, if it is this person's, at this school, and still live; and
   * the person and switches re-checked. Ends the session (with the reason)
   * when it is stale or revoked, then refuses.
   */
  private async guard(auth: AuthContext, sessionId: string, opts: { recheck: boolean } = { recheck: true }): Promise<VoiceSessionRow> {
    const row = await this.load(auth, sessionId);
    if (row.status !== "ACTIVE") throw this.ended(row.endReason as VoiceEndReason | null);
    const stale = this.ledger.staleReason(row);
    if (stale) {
      await this.endRow(auth, row, stale);
      throw this.ended(stale);
    }
    if (!opts.recheck) return row;
    let blockers: VoiceBlocker[];
    try {
      blockers = (await this.evaluate(auth)).blockers;
    } catch (e) {
      if (e instanceof UnauthorizedError || e instanceof ForbiddenError) await this.endRow(auth, row, "REVOKED");
      throw e;
    }
    const revoking = blockers.filter((b) => REVOKING_BLOCKERS.has(b));
    if (revoking.length > 0) {
      await this.endRow(auth, row, "REVOKED");
      throw new ForbiddenError(VOICE_ERROR_CODES.UNAVAILABLE, VOICE_BLOCKER_TEXT[revoking[0]!], { blockers: revoking, endReason: "REVOKED" });
    }
    return row;
  }

  private async load(auth: AuthContext, sessionId: string): Promise<VoiceSessionRow> {
    const row = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)
      ? await withTenant(auth.schoolId, (db) =>
          db.assistantVoiceSession.findFirst({ where: { id: sessionId, schoolId: auth.schoolId, userId: auth.userId } }),
        )
      : null;
    if (!row) throw new NotFoundError("Voice session not found.", { code: VOICE_ERROR_CODES.SESSION_NOT_FOUND });
    return row;
  }

  private ended(reason: VoiceEndReason | null): ConflictError {
    return new ConflictError(VOICE_ERROR_CODES.SESSION_ENDED, "This voice session has ended.", { endReason: reason });
  }

  private async endRow(auth: AuthContext, row: VoiceSessionRow, reason: VoiceEndReason): Promise<void> {
    const ended = await withTenant(auth.schoolId, (db) => this.ledger.finalise(db, row, reason));
    this.abortSpeech(row.id);
    this.inFlight.delete(row.id);
    if (ended) this.logger.log(`Voice session ended: school=${auth.schoolId} session=${row.id} reason=${reason}`);
  }

  private async reload(auth: AuthContext, id: string): Promise<VoiceSessionDto> {
    return this.ledger.toDto(await this.load(auth, id));
  }

  // ---- Session calls ------------------------------------------------------------------

  async get(auth: AuthContext, sessionId: string): Promise<VoiceSessionDto> {
    const row = await this.load(auth, sessionId);
    const stale = this.ledger.staleReason(row);
    if (stale) await this.endRow(auth, row, stale);
    return this.reload(auth, sessionId);
  }

  /** A fresh provider credential for reconnecting (network change, ICE failure). Capped per session. */
  async credentials(auth: AuthContext, sessionId: string): Promise<{ session: VoiceSessionDto; credential: VoiceCredentialDto }> {
    const row = await this.guard(auth, sessionId);
    const claimed = await withTenant(auth.schoolId, (db) =>
      db.assistantVoiceSession.updateMany({
        where: { id: row.id, schoolId: auth.schoolId, status: "ACTIVE", credentialCount: { lt: this.config.maxCredentialsPerSession } },
        data: { credentialCount: { increment: 1 }, lastActivityAt: this.nowDate() },
      }),
    );
    if (claimed.count !== 1) {
      throw new RateLimitError(VOICE_ERROR_CODES.CREDENTIAL_LIMIT, "This voice session has reconnected too many times. End it and start a new one.");
    }
    const credential = await this.mint(row);
    return { session: await this.reload(auth, sessionId), credential };
  }

  async heartbeat(auth: AuthContext, sessionId: string): Promise<VoiceSessionDto> {
    const row = await this.guard(auth, sessionId);
    await withTenant(auth.schoolId, (db) =>
      db.assistantVoiceSession.updateMany({ where: { id: row.id, schoolId: auth.schoolId, status: "ACTIVE" }, data: { lastActivityAt: this.nowDate() } }),
    );
    return this.reload(auth, sessionId);
  }

  async end(auth: AuthContext, sessionId: string): Promise<VoiceSessionDto> {
    const row = await this.load(auth, sessionId);
    if (row.status === "ACTIVE") await this.endRow(auth, row, this.ledger.staleReason(row) ?? "USER_ENDED");
    return this.reload(auth, sessionId);
  }

  async interrupt(auth: AuthContext, sessionId: string, input: VoiceInterruptInput): Promise<VoiceSessionDto> {
    const row = await this.guard(auth, sessionId, { recheck: false });
    const turn = this.inFlight.get(row.id);
    if (turn && (!input.turnId || input.turnId === turn.turnId)) turn.interrupted = true;
    this.abortSpeech(row.id);
    await withTenant(auth.schoolId, (db) =>
      db.assistantVoiceSession.updateMany({
        where: { id: row.id, schoolId: auth.schoolId, status: "ACTIVE" },
        data: { interruptionCount: { increment: 1 }, lastActivityAt: this.nowDate() },
      }),
    );
    return this.reload(auth, sessionId);
  }

  // ---- Turns ---------------------------------------------------------------------------

  async turn(auth: AuthContext, sessionId: string, input: VoiceTurnInput): Promise<VoiceTurnDto> {
    const row = await this.guard(auth, sessionId);

    // Replay protection: a turn id is accepted once per session. The check
    // and the record are one statement, so two copies of a request cannot
    // both pass. Only the last 20 ids are kept; they are UUIDs, not content.
    const accepted = await withTenant(auth.schoolId, (db) => db.$executeRaw`
      UPDATE assistant_voice_sessions
         SET recent_turn_ids = (array_append(recent_turn_ids, ${input.turnId}::text))[GREATEST(1, cardinality(recent_turn_ids) - 18):],
             turn_count = turn_count + 1,
             last_activity_at = ${this.nowDate()}
       WHERE id = ${row.id} AND school_id = ${auth.schoolId} AND status = 'ACTIVE'
         AND NOT (${input.turnId}::text = ANY(recent_turn_ids))
    `);
    if (accepted !== 1) throw new ConflictError(VOICE_ERROR_CODES.TURN_REPLAYED, "This turn was already sent.");

    const flight: InFlightTurn = { turnId: input.turnId, interrupted: false };
    this.inFlight.set(row.id, flight);
    let result: AssistantTurnDto;
    let deflected = false;
    try {
      const spoken = input.turn.messages[input.turn.messages.length - 1]!.text;
      if (input.inputMode === "voice" && isSpokenApproval(spoken)) {
        // Never a model call, never an approval: the card is the only control.
        deflected = true;
        result = { outcome: "answered", reply: SPOKEN_APPROVAL_REPLY, actions: [], blockedCategories: [], toolsUsed: [] };
      } else {
        // EXACTLY the chat's turn: same input schema, same service, same gates.
        result = await this.orchestrator.turn(auth, input.turn);
      }
    } finally {
      if (this.inFlight.get(row.id) === flight) this.inFlight.delete(row.id);
    }

    const approvalRequiresCard = actionsNeedCardApproval(result);
    let speech: VoiceTurnDto["speech"] = null;
    if (!flight.interrupted) {
      // The text goes to the speech provider: nothing the school holds leaves in it.
      const text = (await loadProviderEgressGuard(auth.schoolId)).redact(speakableReply(result, approvalRequiresCard)).text;
      if (text.length > 0) {
        const signed = signSpeech(row.id, input.turnId, text, this.ledger.now());
        speech = { text, token: signed.token, expiresAt: signed.expiresAt.toISOString() };
      }
    }
    this.logger.log(`Voice turn: school=${auth.schoolId} session=${row.id} mode=${input.inputMode} outcome=${result.outcome} deflected=${deflected} interrupted=${flight.interrupted} tools=${result.toolsUsed.join(",")}`);
    return {
      turnId: input.turnId,
      turn: result,
      speech,
      approvalRequiresCard,
      spokenApprovalDeflected: deflected,
      interrupted: flight.interrupted,
      session: await this.reload(auth, sessionId),
    };
  }

  // ---- Speech ----------------------------------------------------------------------------

  /**
   * Streams speech for text this server wrote for this session's turn. The
   * caller passes `signal` tied to the HTTP request: the browser aborting
   * (barge-in, End, navigation) stops the provider stream at once.
   */
  async speech(auth: AuthContext, sessionId: string, input: VoiceSpeechInput, signal: AbortSignal): Promise<VoiceSpeechStream & { characters: number }> {
    const row = await this.guard(auth, sessionId);
    if (!verifySpeech(row.id, input.turnId, input.text, input.token, this.ledger.now())) {
      throw new ForbiddenError(VOICE_ERROR_CODES.SPEECH_TOKEN_INVALID, "This reply can no longer be spoken. Read it on screen.");
    }
    const chars = input.text.length;
    const claimed = await withTenant(auth.schoolId, (db) => db.$executeRaw`
      UPDATE assistant_voice_sessions
         SET speech_characters = speech_characters + ${chars}, last_activity_at = ${this.nowDate()}
       WHERE id = ${row.id} AND school_id = ${auth.schoolId} AND status = 'ACTIVE'
         AND speech_characters + ${chars} <= ${this.config.maxSpeechCharsPerSession}
    `);
    if (claimed !== 1) throw new RateLimitError(VOICE_ERROR_CODES.SPEECH_LIMIT, "This session's spoken replies are used up. Replies will still appear on screen.");

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) controller.abort();
    const set = this.speaking.get(row.id) ?? new Set<AbortController>();
    set.add(controller);
    this.speaking.set(row.id, set);
    const release = () => {
      signal.removeEventListener("abort", onAbort);
      set.delete(controller);
      if (set.size === 0) this.speaking.delete(row.id);
    };
    controller.signal.addEventListener("abort", release, { once: true });

    try {
      const stream = await this.provider!.synthesise({ text: input.text, model: this.config.speechModel, voice: this.config.speechVoice, signal: controller.signal });
      const body = this.releasing(stream.body, release);
      return { contentType: stream.contentType, body, characters: chars };
    } catch (e) {
      release();
      // Nothing was spoken: give the characters back.
      await withTenant(auth.schoolId, (db) =>
        db.assistantVoiceSession.updateMany({ where: { id: row.id, schoolId: auth.schoolId }, data: { speechCharacters: { decrement: chars } } }),
      );
      if (e instanceof VoiceProviderError) {
        this.logger.warn(`Voice speech failed: session=${row.id} status=${e.status ?? "none"}`);
        throw new UpstreamError(VOICE_ERROR_CODES.PROVIDER_FAILED, "Spoken replies are unavailable right now. The reply is on screen.");
      }
      throw e;
    }
  }

  private async *releasing(body: AsyncIterable<Uint8Array>, release: () => void): AsyncIterable<Uint8Array> {
    try {
      for await (const chunk of body) yield chunk;
    } finally {
      release();
    }
  }

  private abortSpeech(sessionId: string): void {
    for (const c of this.speaking.get(sessionId) ?? []) c.abort();
    this.speaking.delete(sessionId);
  }

  /** For tests and diagnostics: how many speech streams this process is serving for a session. */
  activeSpeechStreams(sessionId: string): number {
    return this.speaking.get(sessionId)?.size ?? 0;
  }
}
