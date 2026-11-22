import { Inject, Injectable } from "@nestjs/common";
import { withTenant } from "@school-kit/db";
import type { VoiceEndReason, VoiceLimitsDto, VoiceSessionDto, VoiceSessionStatus } from "@school-kit/types";

import { DEFAULT_MONTHLY_TOKEN_BUDGET, currentPeriodStart } from "../../common/ai/ai.constants.js";
import { VOICE_CONFIG, type VoiceConfig } from "./voice.config.js";

// Voice metering and lifecycle bookkeeping (docs/modules/assistant-voice.md,
// "Usage and cost"). Shared by the staff endpoints and the platform admin.
//
// THE UNIT IS SECONDS OF OPEN SESSION, per school per UTC month. The audio
// itself never passes through SchoolKit (the browser streams it straight to
// the provider), so the server bills wall-clock time between start and end,
// which bounds what the provider can bill for transcription. A session's whole
// allowance is RESERVED when it starts (its expiresAt), so concurrent sessions
// can never jointly overspend the school's minutes; the reservation is settled
// to the real duration when it ends.
//
// No cron: a session past its expiry or idle limit is ended the next time
// anything reads it or starts another session at the school.

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

export interface VoiceSessionRow {
  id: string;
  schoolId: string;
  userId: string;
  status: string;
  provider: string;
  startedAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  credentialCount: number;
  turnCount: number;
  interruptionCount: number;
  speechCharacters: number;
  billedSeconds: number;
  estimatedCostMicroUsd: number;
}

export interface VoiceMonthUsage {
  budgetSeconds: number;
  /** Settled seconds of ended sessions plus elapsed seconds of live ones. */
  usedSeconds: number;
  /** Budget minus settled seconds minus live sessions' full reservations. */
  remainingSeconds: number;
  sessions: number;
  activeSessions: number;
  estimatedCostMicroUsd: number;
}

const secondsBetween = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / 1000));

@Injectable()
export class VoiceLedger {
  /** Injectable clock for tests. */
  now: () => number = Date.now;

  constructor(@Inject(VOICE_CONFIG) readonly config: VoiceConfig) {}

  limits(): VoiceLimitsDto {
    const c = this.config;
    return {
      maxSessionSeconds: c.maxSessionSeconds,
      idleTimeoutSeconds: c.idleTimeoutSeconds,
      heartbeatSeconds: c.heartbeatSeconds,
      maxConcurrentSessionsPerSchool: c.maxConcurrentPerSchool,
      maxConcurrentSessionsPerUser: 1,
      maxCredentialsPerSession: c.maxCredentialsPerSession,
      maxSpeechCharactersPerSession: c.maxSpeechCharsPerSession,
      credentialTtlSeconds: c.credentialTtlSeconds,
    };
  }

  effectiveBudget(stored: number | null): number {
    return stored ?? this.config.defaultMonthlySeconds;
  }

  /** Why a live row must end now, or null if it is still live. */
  staleReason(row: VoiceSessionRow, now = new Date(this.now())): VoiceEndReason | null {
    if (row.status !== "ACTIVE") return null;
    if (now >= row.expiresAt) return "EXPIRED";
    if (now.getTime() - row.lastActivityAt.getTime() > this.config.idleTimeoutSeconds * 1000) return "IDLE";
    return null;
  }

  /** The moment a session stopped being billable when ending it for `reason`. */
  private billableEnd(row: VoiceSessionRow, reason: VoiceEndReason, now: Date): Date {
    const idleEnd = new Date(row.lastActivityAt.getTime() + this.config.idleTimeoutSeconds * 1000);
    const end = reason === "IDLE" ? idleEnd : now;
    return new Date(Math.min(end.getTime(), row.expiresAt.getTime(), Math.max(now.getTime(), row.startedAt.getTime())));
  }

  cost(seconds: number, speechChars: number): number {
    return seconds * this.config.costMicroUsdPerSecond + speechChars * this.config.costMicroUsdPerSpeechChar;
  }

  /**
   * Ends one live session and settles its seconds. Race-safe: only a row
   * still ACTIVE is changed, so two enders settle it once. Returns whether
   * this call ended it.
   */
  async finalise(db: Db, row: VoiceSessionRow, reason: VoiceEndReason): Promise<boolean> {
    if (row.status !== "ACTIVE") return false;
    const now = new Date(this.now());
    const billed = secondsBetween(row.startedAt, this.billableEnd(row, reason, now));
    const res = await db.assistantVoiceSession.updateMany({
      where: { id: row.id, schoolId: row.schoolId, status: "ACTIVE" },
      data: {
        status: "ENDED",
        endedAt: now,
        endReason: reason,
        billedSeconds: billed,
        estimatedCostMicroUsd: this.cost(billed, row.speechCharacters),
      },
    });
    return res.count === 1;
  }

  /** Ends every stale live session at the school. Call inside the school's transaction. */
  async sweep(db: Db, schoolId: string): Promise<number> {
    const live = await db.assistantVoiceSession.findMany({ where: { schoolId, status: "ACTIVE" } });
    let ended = 0;
    for (const row of live) {
      const reason = this.staleReason(row);
      if (reason && (await this.finalise(db, row, reason))) ended += 1;
    }
    return ended;
  }

  async monthUsage(db: Db, schoolId: string): Promise<VoiceMonthUsage> {
    const nowMs = this.now();
    const period = currentPeriodStart(new Date(nowMs));
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { voiceMonthlySecondsBudget: true } });
    const budgetSeconds = this.effectiveBudget(school?.voiceMonthlySecondsBudget ?? null);
    const rows = await db.assistantVoiceSession.findMany({
      where: { schoolId, startedAt: { gte: period } },
      select: { status: true, startedAt: true, expiresAt: true, billedSeconds: true, estimatedCostMicroUsd: true, speechCharacters: true },
    });
    let settled = 0;
    let reserved = 0;
    let elapsed = 0;
    let cost = 0;
    let active = 0;
    for (const r of rows) {
      if (r.status === "ACTIVE") {
        active += 1;
        reserved += secondsBetween(r.startedAt, r.expiresAt);
        const e = secondsBetween(r.startedAt, new Date(Math.min(nowMs, r.expiresAt.getTime())));
        elapsed += e;
        cost += this.cost(e, r.speechCharacters);
      } else {
        settled += r.billedSeconds;
        cost += r.estimatedCostMicroUsd;
      }
    }
    return {
      budgetSeconds,
      usedSeconds: settled + elapsed,
      remainingSeconds: Math.max(0, budgetSeconds - settled - reserved),
      sessions: rows.length,
      activeSessions: active,
      estimatedCostMicroUsd: cost,
    };
  }

  /** Whether the school's AI token allowance is used up (the model turn would refuse). */
  async aiBudgetExhausted(db: Db, schoolId: string): Promise<boolean> {
    const periodStart = currentPeriodStart(new Date(this.now()));
    const [school, period] = await Promise.all([
      db.school.findUnique({ where: { id: schoolId }, select: { aiMonthlyTokenBudget: true } }),
      db.aIBudgetPeriod.findUnique({ where: { schoolId_periodStart: { schoolId, periodStart } }, select: { tokensReserved: true } }),
    ]);
    return (period?.tokensReserved ?? 0) >= (school?.aiMonthlyTokenBudget ?? DEFAULT_MONTHLY_TOKEN_BUDGET);
  }

  /** Ends every live session at a school (platform admin). Returns how many it ended. */
  async endAll(schoolId: string, reason: VoiceEndReason): Promise<number> {
    return withTenant(schoolId, async (db) => {
      const live = await db.assistantVoiceSession.findMany({ where: { schoolId, status: "ACTIVE" } });
      let ended = 0;
      for (const row of live) if (await this.finalise(db, row, reason)) ended += 1;
      return ended;
    }, { label: "assistant-voice-end-all" });
  }

  toDto(row: VoiceSessionRow): VoiceSessionDto {
    const nowMs = this.now();
    const live = row.status === "ACTIVE";
    const elapsed = live ? secondsBetween(row.startedAt, new Date(Math.min(nowMs, row.expiresAt.getTime()))) : row.billedSeconds;
    return {
      sessionId: row.id,
      status: row.status as VoiceSessionStatus,
      startedAt: row.startedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      endedAt: row.endedAt?.toISOString() ?? null,
      endReason: (row.endReason as VoiceEndReason | null) ?? null,
      usage: {
        secondsElapsed: elapsed,
        secondsRemaining: live ? secondsBetween(new Date(nowMs), row.expiresAt) : 0,
        turns: row.turnCount,
        interruptions: row.interruptionCount,
        speechCharactersUsed: row.speechCharacters,
        speechCharactersRemaining: Math.max(0, this.config.maxSpeechCharsPerSession - row.speechCharacters),
        credentialsIssued: row.credentialCount,
        estimatedCostMicroUsd: live ? this.cost(elapsed, row.speechCharacters) : row.estimatedCostMicroUsd,
      },
    };
  }
}
