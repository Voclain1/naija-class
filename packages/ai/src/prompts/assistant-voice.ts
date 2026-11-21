// Realtime voice for the SchoolKit Assistant (2026-11-21,
// docs/modules/assistant-voice.md).
//
// Voice adds NO prompt of its own: what the person says becomes text and goes
// through the `assistant-orchestrator` prompt exactly as typed text does. What
// it adds is a second recipient: the speech provider receives the person's
// AUDIO (to transcribe it) and the assistant's checked reply text (to speak
// it). Audio cannot pass the per-school detectors before it leaves, so a name
// or a phone number spoken aloud reaches the speech provider even though it
// never reaches the model. That is a new data flow, and it needs its own row
// and the owner's sign-off, with the provider's data-processing terms
// reviewed. The proposed wording is in the module doc.
//
// Until then this stays "pending" and the API refuses voice in production,
// whatever a school's switch says. Changing it is the code half of that
// approval and belongs in the same change as the CLAUDE.md row. The evals pin
// it.
export const ASSISTANT_VOICE_APPROVAL: "pending" | "approved" = "pending";
