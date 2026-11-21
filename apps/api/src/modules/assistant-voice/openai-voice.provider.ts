import { Logger } from "@nestjs/common";

import {
  VoiceProviderError,
  type VoiceCredential,
  type VoiceCredentialRequest,
  type VoiceProviderPort,
  type VoiceSpeechRequest,
  type VoiceSpeechStream,
} from "./voice-provider.port.js";

// OpenAI as the speech provider (docs/modules/assistant-voice.md, "Provider").
//
// Two REST calls, server side, with the server key:
//   POST {base}/realtime/client_secrets  → an ephemeral key for one
//        TRANSCRIPTION session (type "transcription": the provider transcribes
//        and detects turns; it does not answer, reason or call tools). The
//        browser uses it to POST its SDP offer to {base}/realtime/calls.
//   POST {base}/audio/speech            → streamed speech for server text.
//
// The request shapes follow OpenAI's published Realtime GA and Audio API
// references as understood when this was written. They could not be checked
// against the live reference from the build environment, so they are listed
// under "verify before go-live" in the module doc, and the adapter is the only
// file that changes if they differ. Provider error bodies are never read into
// logs or errors: only the HTTP status is kept.

const CREDENTIAL_TIMEOUT_MS = 8_000;
const SPEECH_CONNECT_TIMEOUT_MS = 10_000;

export class OpenAiVoiceProvider implements VoiceProviderPort {
  readonly name = "openai" as const;
  private readonly logger = new Logger(OpenAiVoiceProvider.name);

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async mintCredential(req: VoiceCredentialRequest): Promise<VoiceCredential> {
    const turnDetection =
      req.turnDetection.type === "semantic_vad"
        ? { type: "semantic_vad", eagerness: "auto" }
        : { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: req.turnDetection.silenceMs };
    const body = {
      expires_after: { anchor: "created_at", seconds: req.ttlSeconds },
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            noise_reduction: { type: "near_field" },
            transcription: { model: req.transcriptionModel, language: req.language, prompt: req.vocabularyPrompt },
            turn_detection: turnDetection,
          },
        },
      },
    };
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/realtime/client_secrets`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
      });
    } catch {
      throw new VoiceProviderError("credential", null);
    }
    if (!res.ok) {
      this.logger.warn(`Voice credential refused by provider: status=${res.status}`);
      throw new VoiceProviderError("credential", res.status);
    }
    const json = (await res.json().catch(() => null)) as { value?: unknown; expires_at?: unknown } | null;
    const secret = typeof json?.value === "string" ? json.value : null;
    const expires = typeof json?.expires_at === "number" ? new Date(json.expires_at * 1000) : null;
    if (!secret || !expires || Number.isNaN(expires.getTime())) throw new VoiceProviderError("credential", res.status);
    return { clientSecret: secret, expiresAt: expires, connectUrl: `${this.baseUrl}/realtime/calls`, dataChannel: "oai-events" };
  }

  async synthesise(req: VoiceSpeechRequest): Promise<VoiceSpeechStream> {
    // The connect timeout covers waiting for the response headers only; once
    // audio is flowing, only the caller's signal (barge-in, disconnect) ends it.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    req.signal.addEventListener("abort", onAbort, { once: true });
    if (req.signal.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), SPEECH_CONNECT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          voice: req.voice,
          input: req.text,
          response_format: "mp3",
          instructions: "Speak clearly and warmly at a moderate pace, as a helpful school office assistant.",
        }),
        signal: controller.signal,
      });
    } catch {
      req.signal.removeEventListener("abort", onAbort);
      throw new VoiceProviderError("speech", null);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok || !res.body) {
      req.signal.removeEventListener("abort", onAbort);
      this.logger.warn(`Voice speech refused by provider: status=${res.status}`);
      throw new VoiceProviderError("speech", res.status);
    }
    return { contentType: res.headers.get("content-type") ?? "audio/mpeg", body: res.body as unknown as AsyncIterable<Uint8Array> };
  }
}
