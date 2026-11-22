import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { ASSISTANT_BLOCK_LABELS, type AssistantTurnDto } from "@school-kit/types";

import { resolveResultPinKey } from "../result-checker/result-pin-key.js";

// What the assistant says aloud, and the proof that the SERVER wrote it
// (docs/modules/assistant-voice.md, "Speech").
//
// The speech endpoint speaks only text this server produced for a given
// session and turn: the turn response carries an HMAC over (session, turn,
// text, expiry), and POST …/speech refuses anything else. So the endpoint is
// never a general text-to-speech service, a forged "your invoices were
// approved" can never be voiced, and the server keeps no reply text to check
// against (it stores none).
//
// The key is the result-checker key (RESULT_PIN_HMAC_KEY, required in
// production), under a label of its own, the same pattern as admission
// tracking links. Rotating it only invalidates speech tokens younger than
// SPEECH_TOKEN_TTL_SECONDS.

const LABEL = "assistant-voice-speech:v1:";
export const SPEECH_TOKEN_TTL_SECONDS = 120;
export const MAX_SPOKEN_CHARS = 600;

export const SPOKEN_APPROVAL_REPLY =
  "I can't approve anything by voice. Please check the card on your screen and tap Approve there if it's right.";
const REVIEW_NUDGE = "Please review the card on your screen and tap Approve there if it's right.";

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64url");
}

function mac(key: string, sessionId: string, turnId: string, text: string, exp: number): string {
  return createHmac("sha256", key).update(`${LABEL}${sessionId}:${turnId}:${exp}:${digest(text)}`).digest("base64url");
}

export function signSpeech(sessionId: string, turnId: string, text: string, now = Date.now(), key = resolveResultPinKey()): { token: string; expiresAt: Date } {
  const exp = Math.floor(now / 1000) + SPEECH_TOKEN_TTL_SECONDS;
  return { token: `${exp}.${mac(key, sessionId, turnId, text, exp)}`, expiresAt: new Date(exp * 1000) };
}

export function verifySpeech(sessionId: string, turnId: string, text: string, token: string, now = Date.now(), key = resolveResultPinKey()): boolean {
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp * 1000 < now) return false;
  const expected = Buffer.from(mac(key, sessionId, turnId, text, exp));
  const given = Buffer.from(m[2]!);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The reply as it may be spoken. Built from the server-checked reply only.
 * Markers (⟨P1⟩) and internal handles (t1, s2) are not read out; long text
 * is cut at a sentence. When the turn produced or showed a reviewable card,
 * the person is told to approve ON THE CARD — voice never says it approved.
 */
export function speakableReply(turn: AssistantTurnDto, approvalRequiresCard: boolean): string {
  if (turn.outcome === "blocked") {
    const found = turn.blockedCategories.map((c) => ASSISTANT_BLOCK_LABELS[c] ?? "personal details");
    const what = found.length > 0 ? [...new Set(found)].join(" and ") : "personal details";
    return `I didn't send that, because it seemed to include ${what}. Please say it again without personal details.`;
  }
  let text = turn.reply
    .replace(/⟨P\d+⟩/g, "that person")
    .replace(/\b[ts][1-9]\b/g, "")
    .replace(/[*_`#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > MAX_SPOKEN_CHARS) {
    const cut = text.slice(0, MAX_SPOKEN_CHARS);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    text = end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
  }
  if (approvalRequiresCard && !/tap approve/i.test(text)) text = `${text} ${REVIEW_NUDGE}`.trim();
  return text;
}

/** Whether any action leads to (or shows) a reviewable preview that only the card can approve. */
export function actionsNeedCardApproval(turn: AssistantTurnDto): boolean {
  return turn.actions.some((a) =>
    a.kind === "invoices" ? a.runId !== null : a.kind === "reminders" || a.kind === "intake" || a.kind === "corrections" || a.kind === "show",
  );
}

// ---- Spoken approval ---------------------------------------------------------
//
// "Yes", "go ahead", "approve it", "send them": in a voice conversation these
// are what a person says while LOOKING at a preview. They must never become an
// approval. The orchestrator has no approval tool, so nothing could be
// approved anyway; this answers such utterances directly, without a model
// call, so the person is told plainly where approval happens. A request that
// names work to PREPARE ("send reminders to JSS 2") is not matched and goes to
// the assistant as usual.

const CONSENT = new Set([
  "yes", "yeah", "yep", "yup", "yes please", "ok", "okay", "ok then", "sure", "alright", "all right", "correct", "that's right",
  "go ahead", "go on", "proceed", "continue", "do it", "do that", "do so", "carry on", "fine", "confirmed", "approved", "i approve",
  "i confirm", "i agree", "agreed", "send", "submit", "finalise", "finalize", "execute", "issue", "apply", "save",
]);
const APPROVE_VERB = /^(please\s+)?(approve|confirm|authori[sz]e|finali[sz]e|execute)\b/;
const PRONOUN_ACTION = /^(please\s+)?(yes,?\s+)?(go ahead and\s+)?(send|issue|approve|confirm|submit|apply|save|do|run)\s+(it|them|that|those|this|these|everything|all of them|the lot)(\s+now)?(\s+please)?$/;

export function isSpokenApproval(transcript: string): boolean {
  const t = transcript
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[.!?,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length === 0) return false;
  if (CONSENT.has(t)) return true;
  // "yes please go ahead", "okay go ahead", "yes do it"
  const words = t.split(" ");
  if (words.length <= 6 && words.every((w) => /^(yes|yeah|yep|ok|okay|sure|please|go|ahead|do|it|that|now|then|alright|proceed|right|fine)$/.test(w)) && /\b(yes|yeah|yep|ok|okay|sure|ahead|proceed|do)\b/.test(t)) {
    return true;
  }
  return APPROVE_VERB.test(t) || PRONOUN_ACTION.test(t);
}
