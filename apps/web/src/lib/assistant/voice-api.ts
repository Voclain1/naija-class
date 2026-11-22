import type {
  VoiceCapabilitiesDto,
  VoiceSessionDto,
  VoiceSessionStartDto,
  VoiceTurnInput,
  VoiceTurnDto,
  VoiceSpeechInput,
  VoiceCredentialDto,
  VoiceInterruptInput,
} from "@school-kit/types";
import { apiFetch, apiFetchResponse } from "@/lib/api-client";

/**
 * Voice contract v1. All operations use the authenticated SchoolKit API.
 * Never persist the ephemeral credential, audio or transcript in storage.
 * The provider WebRTC connection is created only after an explicit user gesture.
 */
const root = "/assistant/voice";
const session = (id: string) => `${root}/sessions/${encodeURIComponent(id)}`;

export const assistantVoiceApi = {
  capabilities: () => apiFetch<VoiceCapabilitiesDto>(`${root}/capabilities`),
  start: () => apiFetch<VoiceSessionStartDto>(`${root}/sessions`, {
    method: "POST", body: { activation: "user-gesture" },
  }),
  get: (id: string) => apiFetch<VoiceSessionDto>(session(id)),
  credentials: (id: string) => apiFetch<{ session: VoiceSessionDto; credential: VoiceCredentialDto }>(
    `${session(id)}/credentials`, { method: "POST", body: {} },
  ),
  heartbeat: (id: string) => apiFetch<VoiceSessionDto>(`${session(id)}/heartbeat`, {
    method: "POST", body: {},
  }),
  turn: (id: string, input: VoiceTurnInput) => apiFetch<VoiceTurnDto>(`${session(id)}/turns`, {
    method: "POST", body: input,
  }),
  interrupt: (id: string, input: VoiceInterruptInput) => apiFetch<VoiceSessionDto>(
    `${session(id)}/interrupt`, { method: "POST", body: input },
  ),
  end: (id: string) => apiFetch<VoiceSessionDto>(`${session(id)}/end`, {
    method: "POST", body: {},
  }),
  speech: (id: string, input: VoiceSpeechInput, signal?: AbortSignal) => apiFetchResponse(
    `${session(id)}/speech`, { method: "POST", body: input, signal },
  ),
};
