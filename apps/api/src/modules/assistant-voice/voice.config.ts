// SchoolKit Assistant voice: deployment settings (docs/modules/assistant-voice.md,
// "Configuration"). Read once at start. Every value has a conservative default
// and is clamped, so a typo can tighten a limit but never remove one.
//
// VOICE_PROVIDER is "none" unless set: with no provider the voice endpoints
// answer PROVIDER_NOT_CONFIGURED and never fake audio.

export type VoiceProviderName = "openai";

export interface VoiceConfig {
  provider: VoiceProviderName | null;
  /** The provider's server key. Never leaves the server; never logged. */
  apiKey: string | null;
  apiBaseUrl: string;
  transcriptionModel: string;
  speechModel: string;
  speechVoice: string;
  language: string;
  turnDetection: "server_vad" | "semantic_vad";
  silenceMs: number;
  maxSessionSeconds: number;
  idleTimeoutSeconds: number;
  heartbeatSeconds: number;
  credentialTtlSeconds: number;
  maxCredentialsPerSession: number;
  maxConcurrentPerSchool: number;
  maxSpeechCharsPerSession: number;
  defaultMonthlySeconds: number;
  /** Smallest allowance a new session may start with; below this it is refused. */
  minSessionSeconds: number;
  /** Cost ESTIMATES for the operator's accounting (micro-USD). See the module doc for their basis. */
  costMicroUsdPerSecond: number;
  costMicroUsdPerSpeechChar: number;
}

const int = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

/** A key that is missing, empty or a CI placeholder is not a key. */
export function isRealKey(key: string | undefined | null): key is string {
  return typeof key === "string" && key.trim().length >= 20 && !/placeholder|not[-_]used|changeme|xxx/i.test(key);
}

export function readVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const provider = (env.VOICE_PROVIDER ?? "").trim().toLowerCase() === "openai" ? "openai" : null;
  const key = env.VOICE_OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  return {
    provider,
    apiKey: provider && isRealKey(key) ? key.trim() : null,
    apiBaseUrl: (env.VOICE_OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    transcriptionModel: env.VOICE_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-transcribe",
    speechModel: env.VOICE_SPEECH_MODEL?.trim() || "gpt-4o-mini-tts",
    speechVoice: env.VOICE_SPEECH_VOICE?.trim() || "alloy",
    language: env.VOICE_LANGUAGE?.trim() || "en",
    turnDetection: env.VOICE_TURN_DETECTION === "semantic_vad" ? "semantic_vad" : "server_vad",
    silenceMs: int(env.VOICE_SILENCE_MS, 700, 200, 3_000),
    maxSessionSeconds: int(env.VOICE_MAX_SESSION_SECONDS, 600, 60, 1_800),
    idleTimeoutSeconds: int(env.VOICE_IDLE_TIMEOUT_SECONDS, 120, 30, 600),
    heartbeatSeconds: int(env.VOICE_HEARTBEAT_SECONDS, 30, 10, 120),
    credentialTtlSeconds: int(env.VOICE_CREDENTIAL_TTL_SECONDS, 60, 10, 120),
    maxCredentialsPerSession: int(env.VOICE_MAX_CREDENTIALS_PER_SESSION, 6, 1, 20),
    maxConcurrentPerSchool: int(env.VOICE_MAX_CONCURRENT_PER_SCHOOL, 3, 1, 50),
    maxSpeechCharsPerSession: int(env.VOICE_MAX_SPEECH_CHARS_PER_SESSION, 12_000, 500, 100_000),
    defaultMonthlySeconds: int(env.VOICE_DEFAULT_MONTHLY_SECONDS, 3_600, 0, 1_000_000),
    minSessionSeconds: 30,
    costMicroUsdPerSecond: int(env.VOICE_COST_MICRO_USD_PER_SECOND, 100, 0, 100_000),
    costMicroUsdPerSpeechChar: int(env.VOICE_COST_MICRO_USD_PER_SPEECH_CHAR, 15, 0, 10_000),
  };
}

export const VOICE_CONFIG = Symbol("VOICE_CONFIG");
