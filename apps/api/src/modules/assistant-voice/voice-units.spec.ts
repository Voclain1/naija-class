import { normaliseVoiceProviderEvent, VOICE_BLOCKERS, VOICE_BLOCKER_TEXT, VOICE_END_REASONS, VOICE_END_REASON_TEXT, type AssistantTurnDto } from "@school-kit/types";
import { describe, expect, it } from "vitest";

import { OpenAiVoiceProvider } from "./openai-voice.provider.js";
import { readVoiceConfig } from "./voice.config.js";
import { voiceApproval, voiceBlockers } from "./voice-gate.js";
import { VOICE_VOCABULARY_PROMPT, VoiceProviderError } from "./voice-provider.port.js";
import {
  MAX_SPOKEN_CHARS,
  SPEECH_TOKEN_TTL_SECONDS,
  actionsNeedCardApproval,
  isSpokenApproval,
  signSpeech,
  speakableReply,
  verifySpeech,
} from "./voice-speech.js";

// Pure parts of SchoolKit Assistant voice (docs/modules/assistant-voice.md):
// the spoken-approval deflection, the speech token, what may be spoken, the
// configuration's clamps, the gate's order, the provider adapter's wire shape
// (with a fake fetch: no network), and the browser-side event normaliser.

const KEY = "test-key-0123456789abcdef0123456789abcdef";
const S = "6f9d1a52-6a8e-4d39-9d0c-5b7a3b0b0001";
const T = "6f9d1a52-6a8e-4d39-9d0c-5b7a3b0b0002";
const turn = (over: Partial<AssistantTurnDto> = {}): AssistantTurnDto => ({ outcome: "answered", reply: "", actions: [], blockedCategories: [], toolsUsed: [], ...over });

describe("spoken approval is never an approval", () => {
  it.each([
    "yes", "Yes.", "yeah", "okay", "OK go ahead", "yes please go ahead", "go ahead", "do it", "proceed", "approve", "Approve it.",
    "please approve the invoices", "confirm", "send them", "yes, send it", "issue them now", "go ahead and send them", "I approve", "approved",
  ])("deflects %j", (t) => expect(isSpokenApproval(t)).toBe(true));

  it.each([
    "Prepare second term invoices for JSS 2",
    "send reminders to JSS 2 families who are overdue",
    "how do I add a new student",
    "find Chidinma Okafor in JSS 2A",
    "leave JSS 2C out",
    "what happened to the reminders",
    "yes but leave out JSS 2C",
    "",
  ])("passes %j to the assistant", (t) => expect(isSpokenApproval(t)).toBe(false));
});

describe("speech token: only server-written text for this session and turn", () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  const { token, expiresAt } = signSpeech(S, T, "The preview is ready.", now, KEY);

  it("verifies the exact text, session and turn, until it expires", () => {
    expect(expiresAt.getTime()).toBe(now + SPEECH_TOKEN_TTL_SECONDS * 1000);
    expect(verifySpeech(S, T, "The preview is ready.", token, now, KEY)).toBe(true);
    expect(verifySpeech(S, T, "The preview is ready.", token, now + SPEECH_TOKEN_TTL_SECONDS * 1000 + 1, KEY)).toBe(false);
  });

  it("refuses altered text, another turn, another session, another key and junk", () => {
    expect(verifySpeech(S, T, "Your invoices were approved.", token, now, KEY)).toBe(false);
    expect(verifySpeech(S, S, "The preview is ready.", token, now, KEY)).toBe(false);
    expect(verifySpeech(T, T, "The preview is ready.", token, now, KEY)).toBe(false);
    expect(verifySpeech(S, T, "The preview is ready.", token, now, `${KEY}x`)).toBe(false);
    expect(verifySpeech(S, T, "The preview is ready.", "nonsense-token-value-here", now, KEY)).toBe(false);
    const [exp, sig] = token.split(".");
    expect(verifySpeech(S, T, "The preview is ready.", `${Number(exp) + 600}.${sig}`, now, KEY)).toBe(false);
  });
});

describe("what may be spoken", () => {
  it("never reads markers or handles, and points at the card for any preview", () => {
    const t = turn({
      reply: "I found ⟨P1⟩ (s1) and prepared t1. **Check it**.",
      actions: [{ kind: "invoices", handle: "t1", termId: S, classArmIds: [], runId: T, problem: null }],
    });
    expect(actionsNeedCardApproval(t)).toBe(true);
    const spoken = speakableReply(t, true);
    expect(spoken).not.toMatch(/⟨|s1|t1|\*/);
    expect(spoken).toContain("that person");
    expect(spoken).toMatch(/tap Approve there/);
  });

  it("an invoice action that could not be prepared needs no approval nudge", () => {
    const t = turn({ reply: "I couldn't prepare that.", actions: [{ kind: "invoices", handle: "t1", termId: S, classArmIds: [], runId: null, problem: "x" }] });
    expect(actionsNeedCardApproval(t)).toBe(false);
    expect(speakableReply(t, false)).toBe("I couldn't prepare that.");
  });

  it("a blocked turn says only the categories, never the text", () => {
    const spoken = speakableReply(turn({ outcome: "blocked", reply: "", blockedCategories: ["phone", "phone", "email"] }), false);
    expect(spoken).toContain("a phone number and an email address");
    expect(spoken).not.toMatch(/\d{5}/);
  });

  it("cuts long replies at a sentence", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const spoken = speakableReply(turn({ reply: long }), false);
    expect(spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(spoken.endsWith(".")).toBe(true);
  });
});

describe("configuration", () => {
  it("has no provider unless one is named, and ignores placeholder keys", () => {
    expect(readVoiceConfig({}).provider).toBeNull();
    expect(readVoiceConfig({ OPENAI_API_KEY: "sk-real-looking-key-1234567890abcdef" }).apiKey).toBeNull();
    expect(readVoiceConfig({ VOICE_PROVIDER: "openai", OPENAI_API_KEY: "sk-placeholder-not-used-in-ci-000000" }).apiKey).toBeNull();
    const c = readVoiceConfig({ VOICE_PROVIDER: "OpenAI", VOICE_OPENAI_API_KEY: "sk-proj-abcdefghijklmnopqrstuvwxyz012345" });
    expect(c).toMatchObject({ provider: "openai", apiKey: "sk-proj-abcdefghijklmnopqrstuvwxyz012345", language: "en", turnDetection: "server_vad" });
  });

  it("clamps every limit: a typo can tighten one but never remove it", () => {
    const c = readVoiceConfig({ VOICE_MAX_SESSION_SECONDS: "999999", VOICE_IDLE_TIMEOUT_SECONDS: "1", VOICE_MAX_CONCURRENT_PER_SCHOOL: "abc", VOICE_CREDENTIAL_TTL_SECONDS: "-5" });
    expect(c.maxSessionSeconds).toBe(1_800);
    expect(c.idleTimeoutSeconds).toBe(30);
    expect(c.maxConcurrentPerSchool).toBe(3);
    expect(c.credentialTtlSeconds).toBe(10);
  });
});

describe("the gate", () => {
  const ok = { switchOn: true, workspaceWorking: true, modelRoutingWorking: true, approvalBlocking: false, providerConfigured: true, voiceSecondsRemaining: 600, minSessionSeconds: 30, aiBudgetExhausted: false };
  it("names every blocker in order", () => {
    expect(voiceBlockers(ok)).toEqual([]);
    expect(voiceBlockers({ switchOn: false, workspaceWorking: false, modelRoutingWorking: false, approvalBlocking: true, providerConfigured: false, voiceSecondsRemaining: 0, minSessionSeconds: 30, aiBudgetExhausted: true })).toEqual([...VOICE_BLOCKERS]);
    expect(voiceBlockers({ ...ok, voiceSecondsRemaining: 29 })).toEqual(["VOICE_BUDGET_EXHAUSTED"]);
    for (const b of VOICE_BLOCKERS) expect(VOICE_BLOCKER_TEXT[b].length).toBeGreaterThan(10);
    for (const r of VOICE_END_REASONS) expect(VOICE_END_REASON_TEXT[r].length).toBeGreaterThan(10);
  });
  it("enforces the pending approval in production only", () => {
    expect(voiceApproval({ NODE_ENV: "production" })).toEqual({ approval: "pending", enforced: true, blocking: true });
    expect(voiceApproval({ NODE_ENV: "test" })).toEqual({ approval: "pending", enforced: false, blocking: false });
  });
});

describe("the OpenAI adapter's wire shape (fake fetch, no network)", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (responses: Response[]): typeof fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return responses.shift()!;
    }) as typeof fetch;

  it("mints a transcription-only credential with the server key, and returns only the ephemeral secret", async () => {
    calls.length = 0;
    const p = new OpenAiVoiceProvider("sk-server-key", "https://api.example.test/v1", fakeFetch([
      new Response(JSON.stringify({ value: "ek_ephemeral", expires_at: 1_900_000_000, session: { type: "transcription" } }), { status: 200 }),
    ]));
    const c = await p.mintCredential({ ttlSeconds: 60, transcriptionModel: "gpt-4o-transcribe", language: "en", vocabularyPrompt: VOICE_VOCABULARY_PROMPT, turnDetection: { type: "server_vad", silenceMs: 700 } });
    expect(c).toEqual({ clientSecret: "ek_ephemeral", expiresAt: new Date(1_900_000_000_000), connectUrl: "https://api.example.test/v1/realtime/calls", dataChannel: "oai-events" });
    expect(calls[0]!.url).toBe("https://api.example.test/v1/realtime/client_secrets");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-server-key");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.expires_after).toEqual({ anchor: "created_at", seconds: 60 });
    expect(body.session.type).toBe("transcription");
    expect(body.session.audio.input.transcription).toMatchObject({ model: "gpt-4o-transcribe", language: "en" });
    expect(body.session.audio.input.turn_detection).toMatchObject({ type: "server_vad", silence_duration_ms: 700 });
    // Transcription only: no instructions, no tools, no output modality.
    expect(JSON.stringify(body)).not.toMatch(/"tools"|"instructions"|output_modalities/);
  });

  it("keeps no provider error text", async () => {
    const p = new OpenAiVoiceProvider("sk", "https://x.test", fakeFetch([new Response("secret internal detail", { status: 401 })]));
    const err = await p.mintCredential({ ttlSeconds: 60, transcriptionModel: "m", language: "en", vocabularyPrompt: "", turnDetection: { type: "server_vad", silenceMs: 500 } }).catch((e) => e);
    expect(err).toBeInstanceOf(VoiceProviderError);
    expect(String(err.message)).not.toContain("secret internal detail");
    expect(err.status).toBe(401);
  });

  it("streams speech for the given text", async () => {
    calls.length = 0;
    const p = new OpenAiVoiceProvider("sk", "https://x.test", fakeFetch([new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } })]));
    const s = await p.synthesise({ text: "Hello.", model: "gpt-4o-mini-tts", voice: "alloy", signal: new AbortController().signal });
    const chunks: number[] = [];
    for await (const c of s.body) chunks.push(...c);
    expect(chunks).toEqual([1, 2, 3]);
    expect(s.contentType).toBe("audio/mpeg");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ model: "gpt-4o-mini-tts", voice: "alloy", input: "Hello.", response_format: "mp3" });
  });
});

describe("browser-side event normaliser", () => {
  it("maps transcription events and drops error text", () => {
    expect(normaliseVoiceProviderEvent({ type: "input_audio_buffer.speech_started", item_id: "i1" })).toEqual({ type: "speech.started", itemId: "i1" });
    expect(normaliseVoiceProviderEvent({ type: "conversation.item.input_audio_transcription.delta", item_id: "i1", delta: "prep" })).toEqual({ type: "transcript.delta", itemId: "i1", text: "prep" });
    expect(normaliseVoiceProviderEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", transcript: " Prepare invoices " })).toEqual({ type: "transcript.final", itemId: "i1", text: "Prepare invoices" });
    expect(normaliseVoiceProviderEvent({ type: "error", error: { code: "session_expired", message: "contains detail" } })).toEqual({ type: "provider.error", code: "session_expired" });
    expect(normaliseVoiceProviderEvent({ type: "response.audio.delta" })).toEqual({ type: "ignored" });
    expect(normaliseVoiceProviderEvent("junk")).toEqual({ type: "ignored" });
  });
});
