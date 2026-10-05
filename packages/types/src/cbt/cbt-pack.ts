import type { PaperVersion } from "../exam-papers/version-shuffle.js";

// Online exams (CBT) — the exam pack (docs/modules/cbt.md D2–D4).
//
// One pack per sitting, built at publish. The ENVELOPE is public: a lab machine
// downloads it ahead of time with the access code. The PAYLOAD inside is
// encrypted with AES-256-GCM under a key derived from the unlock code by
// PBKDF2-SHA256, so the questions stay unreadable until the invigilator types
// that code at the start. Both are standard primitives, available as Node's
// `crypto` (server, builds the pack) and the browser's WebCrypto (lab machine,
// opens it).
//
// The answer key is NEVER in the payload (D4): options carry ids, and marking
// happens on the server.

export const CBT_PACK_FORMAT = "school-kit-cbt-pack/1" as const;

export const CBT_PACK_KDF = {
  name: "PBKDF2",
  hash: "SHA-256",
  iterations: 210_000,
  keyLengthBits: 256,
} as const;

/** What anyone with the access code sees. */
export interface CbtPackEnvelope {
  format: typeof CBT_PACK_FORMAT;
  sittingId: string;
  schoolName: string;
  title: string;
  subjectName: string;
  classLevelName: string;
  startsAt: string;
  windowEndsAt: string;
  durationMinutes: number;
  candidateCount: number;
  builtAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  // base64; ciphertext is WebCrypto's form — the GCM tag appended at the end.
  cipher: { name: "AES-GCM"; iv: string };
  ciphertext: string;
}

export interface CbtPackOption {
  id: string;
  text: string;
}

export interface CbtPackQuestion {
  itemId: string;
  number: number;
  text: string;
  marks: number;
  options: CbtPackOption[];
}

export interface CbtPackSection {
  title: string;
  instructions: string | null;
  questions: CbtPackQuestion[];
}

export interface CbtPackCandidate {
  studentId: string;
  admissionNumber: string;
  // First name and surname initial — enough for "Is this you?", no more.
  displayName: string;
  armName: string;
  version: PaperVersion;
}

/** What the unlock code opens. */
export interface CbtPackPayload {
  format: typeof CBT_PACK_FORMAT;
  sittingId: string;
  schoolId: string;
  instructions: string | null;
  objectiveTotal: number;
  questionCount: number;
  versions: Partial<Record<PaperVersion, CbtPackSection[]>>;
  candidates: CbtPackCandidate[];
}
