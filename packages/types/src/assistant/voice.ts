import { z } from "zod";

import { assistantTurnSchema, type AssistantTurnDto } from "./orchestration.js";

// Realtime voice for the SchoolKit Assistant (2026-11-21,
// docs/modules/assistant-voice.md). CONTRACT VERSION 1.
//
// Voice is a second INTERFACE to the same assistant, never a second agent:
//
//   microphone ──WebRTC──▶ speech provider (transcription + turn detection ONLY)
//        │                       │ transcript events (data channel)
//        │                       ▼
//        │                 browser ──POST …/turns──▶ API ──▶ AssistantOrchestratorService.turn
//        │                                                    (detectors, redaction, ToolRegistry,
//        │                                                     budget, ledger — exactly as chat)
//        ◀──audio stream── API ◀── POST …/speech (text the SERVER wrote, HMAC-bound)
//
// The provider never reasons, never calls a tool and never sees SchoolKit
// data: its credential is minted by the API for a transcription-only session,
// for one user, for under a minute. Approval is never spoken: a "yes" is
// answered with "tap Approve on the card" and changes nothing.
//
// Nothing here carries a school or user id: the API takes both from the
// signed-in session, every request.

export const VOICE_CONTRACT_VERSION = 1 as const;

/** Why voice is not usable, most fundamental first. */
export const VOICE_BLOCKERS = [
  // The school's `assistant-voice` switch is off (the default), or FEATURES_DISABLED names it.
  "SWITCH_OFF",
  // The SchoolKit Assistant panel is off for the school.
  "WORKSPACE_OFF",
  // The model-backed assistant voice relies on is not usable (its own approval, switch, AI settings).
  "MODEL_ROUTING_UNAVAILABLE",
  // ASSISTANT_VOICE_APPROVAL is pending and this is production.
  "APPROVAL_PENDING",
  // No speech provider is configured on this deployment (VOICE_PROVIDER / its key).
  "PROVIDER_NOT_CONFIGURED",
  // The school has used its voice minutes for the month.
  "VOICE_BUDGET_EXHAUSTED",
  // The school has used its AI token budget for the month (turns would be refused).
  "AI_BUDGET_EXHAUSTED",
] as const;
export type VoiceBlocker = (typeof VOICE_BLOCKERS)[number];

export const VOICE_BLOCKER_TEXT: Record<VoiceBlocker, string> = {
  SWITCH_OFF: "Voice is switched off for this school.",
  WORKSPACE_OFF: "The SchoolKit Assistant is switched off for this school.",
  MODEL_ROUTING_UNAVAILABLE: "AI understanding is not available for this school, and voice depends on it.",
  APPROVAL_PENDING: "The owner's approval of voice processing is not recorded in code yet. Production refuses it for every school until it is.",
  PROVIDER_NOT_CONFIGURED: "No speech provider is configured on the server.",
  VOICE_BUDGET_EXHAUSTED: "This school has used its voice minutes for the month.",
  AI_BUDGET_EXHAUSTED: "This school has used its AI allowance for the month.",
};

export const VOICE_SESSION_STATUSES = ["ACTIVE", "ENDED"] as const;
export type VoiceSessionStatus = (typeof VOICE_SESSION_STATUSES)[number];

/** Why a session ended. Shown to the person in plain words (VOICE_END_REASON_TEXT). */
export const VOICE_END_REASONS = [
  "USER_ENDED", // the person tapped End
  "EXPIRED", // reached its maximum length (or the school's remaining minutes)
  "IDLE", // no heartbeat or turn within the idle timeout
  "SUPERSEDED", // the same person started a new session (another tab, a reload)
  "REVOKED", // the person's account, permissions or the school's switches changed
  "ADMIN_ENDED", // a platform admin ended the school's sessions
  "PROVIDER_FAILED", // the speech provider could not start or keep the session
] as const;
export type VoiceEndReason = (typeof VOICE_END_REASONS)[number];

export const VOICE_END_REASON_TEXT: Record<VoiceEndReason, string> = {
  USER_ENDED: "Voice session ended.",
  EXPIRED: "This voice session reached its time limit. Start a new one to continue.",
  IDLE: "Voice session ended after a period of silence.",
  SUPERSEDED: "Voice moved to your newer session.",
  REVOKED: "Voice is no longer available to you. Your text conversation is unaffected.",
  ADMIN_ENDED: "Voice was ended by SchoolKit support.",
  PROVIDER_FAILED: "The voice service is unavailable. You can keep typing.",
};

// ---- GET /assistant/voice/capabilities -------------------------------------

export interface VoiceCapabilitiesDto {
  contractVersion: typeof VOICE_CONTRACT_VERSION;
  available: boolean;
  /** Every reason it is not available; empty when it is. */
  blockers: VoiceBlocker[];
  /** "webrtc" only. A browser without WebRTC or microphone access uses the text chat; there is no degraded speech mode. */
  transports: Array<"webrtc">;
  provider: "openai" | null;
  limits: VoiceLimitsDto;
  /** The school's voice allowance this month, in seconds. */
  usage: { monthlySecondsBudget: number; secondsUsedThisMonth: number; secondsRemainingThisMonth: number };
}

export interface VoiceLimitsDto {
  maxSessionSeconds: number;
  idleTimeoutSeconds: number;
  /** Send POST …/heartbeat at least this often while the session is open. */
  heartbeatSeconds: number;
  maxConcurrentSessionsPerSchool: number;
  /** One live session per person: starting another ends the older one (SUPERSEDED). */
  maxConcurrentSessionsPerUser: 1;
  maxCredentialsPerSession: number;
  maxSpeechCharactersPerSession: number;
  /** A provider credential is usable to CONNECT for this long; refresh via POST …/credentials. */
  credentialTtlSeconds: number;
}

// ---- POST /assistant/voice/sessions -----------------------------------------

/**
 * Sent only from the handler of the person's own tap on the microphone
 * button. `activation` is a literal so no background code path can open a
 * session by accident; the browser must not request microphone access before
 * this call succeeds.
 */
export const voiceSessionCreateSchema = z
  .object({
    activation: z.literal("user-gesture"),
    /** Optional client hint for UI only; never changes limits. */
    clientInfo: z.object({ webrtc: z.boolean(), userAgentFamily: z.string().max(40).optional() }).strict().optional(),
  })
  .strict();
export type VoiceSessionCreateInput = z.infer<typeof voiceSessionCreateSchema>;

export interface VoiceSessionDto {
  sessionId: string;
  status: VoiceSessionStatus;
  startedAt: string;
  /** Hard end: the maximum length, shortened to the school's remaining minutes. */
  expiresAt: string;
  endedAt: string | null;
  endReason: VoiceEndReason | null;
  usage: VoiceSessionUsageDto;
}

export interface VoiceSessionUsageDto {
  secondsElapsed: number;
  secondsRemaining: number;
  turns: number;
  interruptions: number;
  speechCharactersUsed: number;
  speechCharactersRemaining: number;
  credentialsIssued: number;
  /** An estimate in micro-US-dollars, for the operator's accounting. Not a price shown to schools. */
  estimatedCostMicroUsd: number;
}

/**
 * What the browser needs to open the audio connection, and nothing more.
 * `clientSecret` is the provider's short-lived token for ONE transcription
 * session; it is not SchoolKit's key and expires at `expiresAt`. Keep it in
 * memory only: never storage, URLs, logs or analytics.
 */
export interface VoiceCredentialDto {
  provider: "openai";
  transport: "webrtc";
  clientSecret: string;
  expiresAt: string;
  /** POST the SDP offer here with `Authorization: Bearer <clientSecret>` and `Content-Type: application/sdp`. */
  connectUrl: string;
  /** The data channel name the provider's events arrive on. */
  dataChannel: string;
  /** For display and diagnostics only. */
  transcriptionModel: string;
  turnDetection: { type: "server_vad" | "semantic_vad"; silenceMs: number | null };
  language: string;
}

export interface VoiceSessionStartDto {
  session: VoiceSessionDto;
  credential: VoiceCredentialDto;
  limits: VoiceLimitsDto;
}

// ---- POST /assistant/voice/sessions/:id/turns --------------------------------

/**
 * One spoken (or typed, during a voice session) turn. `turn` is EXACTLY the
 * chat endpoint's body (POST /assistant/workspace/turn): the same messages,
 * task states and student refs the browser already holds, with the final
 * transcript as the newest user message. `turnId` is a fresh UUID per turn;
 * reusing one is refused (VOICE_TURN_REPLAYED).
 */
export const voiceTurnSchema = z
  .object({
    turnId: z.string().uuid(),
    inputMode: z.enum(["voice", "text"]),
    turn: assistantTurnSchema,
  })
  .strict();
export type VoiceTurnInput = z.infer<typeof voiceTurnSchema>;

export interface VoiceSpeechDto {
  /** What will be spoken. Already checked by the server; equal to or shorter than the reply. */
  text: string;
  /** Pass to POST …/speech unchanged. Binds the text to this session and turn; short-lived. */
  token: string;
  expiresAt: string;
}

export interface VoiceTurnDto {
  turnId: string;
  /** The chat endpoint's result, unchanged: apply `turn.actions` to task cards exactly as chat does. */
  turn: AssistantTurnDto;
  /** null when there is nothing to say aloud (e.g. the turn was interrupted). */
  speech: VoiceSpeechDto | null;
  /**
   * True when any action produced or refers to a reviewable preview. The UI
   * must show the card's own Approve control; speech never approves.
   */
  approvalRequiresCard: boolean;
  /** The transcript was a spoken approval ("yes", "approve it"). Nothing ran; the reply points at the card. */
  spokenApprovalDeflected: boolean;
  /** The person interrupted while this turn was running; discard it (cards are previews only). */
  interrupted: boolean;
  session: VoiceSessionDto;
}

// ---- POST /assistant/voice/sessions/:id/speech --------------------------------

export const voiceSpeechSchema = z
  .object({ turnId: z.string().uuid(), token: z.string().min(20).max(400), text: z.string().min(1).max(800) })
  .strict();
export type VoiceSpeechInput = z.infer<typeof voiceSpeechSchema>;

/** Response: a streamed audio body. Content-Type `audio/mpeg` (or the provider's), header X-Voice-Speech-Chars. */
export const VOICE_SPEECH_AUDIO_FORMAT = "mp3" as const;

// ---- Other session calls ---------------------------------------------------------

export const voiceInterruptSchema = z
  .object({ turnId: z.string().uuid().optional(), at: z.enum(["thinking", "speaking"]) })
  .strict();
export type VoiceInterruptInput = z.infer<typeof voiceInterruptSchema>;

export const voiceEndSchema = z.object({ reason: z.literal("USER_ENDED").default("USER_ENDED") }).strict();
export type VoiceEndInput = z.infer<typeof voiceEndSchema>;

/** Errors the voice endpoints answer with (the standard `{ error: { code, message } }` shape). */
export const VOICE_ERROR_CODES = {
  UNAVAILABLE: "VOICE_UNAVAILABLE", // 403, details.blockers lists why
  SESSION_NOT_FOUND: "VOICE_SESSION_NOT_FOUND", // 404: not yours, another school's, or unknown
  SESSION_ENDED: "VOICE_SESSION_ENDED", // 409, details.endReason
  CONCURRENCY_LIMIT: "VOICE_CONCURRENCY_LIMIT", // 429: the school's live sessions are at the cap
  BUDGET_EXHAUSTED: "VOICE_BUDGET_EXHAUSTED", // 429: no voice minutes left this month
  CREDENTIAL_LIMIT: "VOICE_CREDENTIAL_LIMIT", // 429: too many reconnects in one session
  SPEECH_LIMIT: "VOICE_SPEECH_LIMIT", // 429: the session's speech characters are used up
  TURN_REPLAYED: "VOICE_TURN_REPLAYED", // 409: this turnId was already used
  SPEECH_TOKEN_INVALID: "VOICE_SPEECH_TOKEN_INVALID", // 403: text not written by the server for this turn, or expired
  PROVIDER_FAILED: "VOICE_PROVIDER_FAILED", // 502: the provider refused or failed; fall back to text
} as const;
export type VoiceErrorCode = (typeof VOICE_ERROR_CODES)[keyof typeof VOICE_ERROR_CODES];

// ---- Normalised transcript events (browser side) ------------------------------

/**
 * The provider's data-channel events, normalised. The browser feeds every
 * raw event through `normaliseVoiceProviderEvent` and drives its UI from
 * these; nothing else about the provider's wire format leaks into the UI.
 */
export type VoiceClientEvent =
  | { type: "speech.started"; itemId: string | null }
  | { type: "speech.stopped"; itemId: string | null }
  | { type: "transcript.delta"; itemId: string; text: string }
  | { type: "transcript.final"; itemId: string; text: string }
  | { type: "transcript.failed"; itemId: string | null }
  | { type: "provider.error"; code: string }
  | { type: "ignored" };

/**
 * Maps one OpenAI Realtime transcription-session event to a VoiceClientEvent.
 * Event names follow OpenAI's documented Realtime event types; verify against
 * the provider's current reference before go-live (docs/modules/assistant-voice.md).
 * Unknown events are ignored, never thrown on. Error messages are dropped:
 * only the code crosses into the app.
 */
export function normaliseVoiceProviderEvent(raw: unknown): VoiceClientEvent {
  if (raw === null || typeof raw !== "object") return { type: "ignored" };
  const e = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const itemId = str(e.item_id);
  switch (e.type) {
    case "input_audio_buffer.speech_started":
      return { type: "speech.started", itemId };
    case "input_audio_buffer.speech_stopped":
      return { type: "speech.stopped", itemId };
    case "conversation.item.input_audio_transcription.delta":
      return itemId && typeof e.delta === "string" ? { type: "transcript.delta", itemId, text: e.delta } : { type: "ignored" };
    case "conversation.item.input_audio_transcription.completed":
      return itemId && typeof e.transcript === "string" ? { type: "transcript.final", itemId, text: e.transcript.trim() } : { type: "ignored" };
    case "conversation.item.input_audio_transcription.failed":
      return { type: "transcript.failed", itemId };
    case "error": {
      const err = e.error && typeof e.error === "object" ? (e.error as Record<string, unknown>) : {};
      return { type: "provider.error", code: str(err.code) ?? str(err.type) ?? "unknown" };
    }
    default:
      return { type: "ignored" };
  }
}

/**
 * The browser's voice states (the UI shows each, including Muted and End).
 * Barge-in: `speech.started` while `speaking` or `thinking` → stop playback,
 * abort the speech/turn fetch, POST …/interrupt, go to `listening`.
 */
export const VOICE_UI_STATES = ["idle", "connecting", "listening", "user-speaking", "thinking", "speaking", "muted", "reconnecting", "ended"] as const;
export type VoiceUiState = (typeof VOICE_UI_STATES)[number];

// ---- Platform admin (docs/modules/assistant-voice.md, "Operator controls") ----

/** GET /platform-admin/schools/:schoolId/voice — read-only status for one school. */
export interface PlatformAdminVoiceStatusDto {
  schoolId: string;
  /** The school's stored `assistant-voice` switch, read now. */
  switchOn: boolean;
  /** True only when nothing blocks voice for staff who can use the Assistant. */
  working: boolean;
  blockers: VoiceBlocker[];
  approval: "pending" | "approved";
  approvalEnforced: boolean;
  provider: "openai" | null;
  providerConfigured: boolean;
  /** null = the platform default (`defaultMonthlySecondsBudget`). */
  monthlySecondsBudget: number | null;
  effectiveMonthlySecondsBudget: number;
  defaultMonthlySecondsBudget: number;
  secondsUsedThisMonth: number;
  sessionsThisMonth: number;
  activeSessions: number;
  estimatedCostMicroUsdThisMonth: number;
  limits: VoiceLimitsDto;
}

/** PATCH /platform-admin/schools/:schoolId/voice-budget. null returns the school to the default. 0 stops voice. */
export const platformAdminSetVoiceBudgetSchema = z
  .object({ monthlySecondsBudget: z.number().int().min(0).max(1_000_000).nullable() })
  .strict();
export type PlatformAdminSetVoiceBudgetInput = z.infer<typeof platformAdminSetVoiceBudgetSchema>;

export interface PlatformAdminSetVoiceBudgetResponse {
  schoolId: string;
  monthlySecondsBudget: number | null;
  effectiveMonthlySecondsBudget: number;
}

/** POST /platform-admin/schools/:schoolId/voice/end-sessions — ends every live voice session at the school. */
export interface PlatformAdminEndVoiceSessionsResponse {
  schoolId: string;
  ended: number;
}
