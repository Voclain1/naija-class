// The speech provider, as the voice module sees it (docs/modules/assistant-voice.md,
// "Provider boundary"). Two operations and nothing else:
//
//   * mint a short-lived credential for ONE transcription-only realtime
//     session the browser connects to directly (WebRTC);
//   * synthesise speech for text the SERVER wrote.
//
// The provider never receives SchoolKit data from the server beyond the
// assistant's checked reply text, and never runs a tool. Tests use a fake.

export interface VoiceCredentialRequest {
  /** How long the credential may be used to CONNECT. */
  ttlSeconds: number;
  transcriptionModel: string;
  language: string;
  /** Vocabulary hint for transcription. School words only, never a person's name. */
  vocabularyPrompt: string;
  turnDetection: { type: "server_vad" | "semantic_vad"; silenceMs: number };
}

export interface VoiceCredential {
  clientSecret: string;
  expiresAt: Date;
  connectUrl: string;
  dataChannel: string;
}

export interface VoiceSpeechRequest {
  text: string;
  model: string;
  voice: string;
  signal: AbortSignal;
}

export interface VoiceSpeechStream {
  contentType: string;
  /** Raw audio chunks. Aborting the request's signal ends it. */
  body: AsyncIterable<Uint8Array>;
}

/** A provider failure. `status` is the provider's HTTP status when there was one; no provider text is kept. */
export class VoiceProviderError extends Error {
  constructor(readonly operation: "credential" | "speech", readonly status: number | null) {
    super(`voice provider ${operation} failed${status ? ` (${status})` : ""}`);
    this.name = "VoiceProviderError";
  }
}

export interface VoiceProviderPort {
  readonly name: "openai";
  mintCredential(req: VoiceCredentialRequest): Promise<VoiceCredential>;
  synthesise(req: VoiceSpeechRequest): Promise<VoiceSpeechStream>;
}

export const VOICE_PROVIDER = Symbol("VOICE_PROVIDER");

/**
 * Words staff say that a general transcriber gets wrong in Nigerian schools.
 * Deliberately no names, places or numbers: this text goes to the provider.
 */
export const VOICE_VOCABULARY_PROMPT =
  "Nigerian school administration, Nigerian English. Words: SchoolKit, JSS 1, JSS 2, JSS 3, SS 1, SS 2, SS 3, " +
  "Primary 1 to Primary 6, Nursery, first term, second term, third term, invoice, invoices, fee reminders, " +
  "debtors, overdue, payment plan, bursar, enrol, enrolment, admission, class arm, head teacher, naira.";
