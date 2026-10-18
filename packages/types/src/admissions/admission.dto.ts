import { z } from "zod";

import { RELATIONSHIP_VALUES } from "../guardians/create-guardian.dto.js";

// Phase 9 / CP7 — online admission applications (docs/modules/phase-9.md §16;
// owner's answers §16.8). Applications are open by default; each school
// shapes its own form in Settings → Admissions.

// ─── The school's form ─────────────────────────────────────────────────────

export const admissionFieldModeValues = ["REQUIRED", "OPTIONAL", "OFF"] as const;
export type AdmissionFieldMode = (typeof admissionFieldModeValues)[number];

export const ADMISSION_FIELD_MODE_LABEL: Record<AdmissionFieldMode, string> = {
  REQUIRED: "Required",
  OPTIONAL: "Optional",
  OFF: "Not asked",
};

/** The built-in fields a school may ask for. The core ones are always asked. */
export const ADMISSION_OPTIONAL_FIELDS = [
  "middleName",
  "previousSchool",
  "previousClass",
  "homeAddress",
  "religion",
  "stateOfOrigin",
  "medicalNeeds",
  "secondGuardian",
] as const;
export type AdmissionOptionalField = (typeof ADMISSION_OPTIONAL_FIELDS)[number];

export const ADMISSION_FIELD_LABEL: Record<AdmissionOptionalField, string> = {
  middleName: "Child's middle name",
  previousSchool: "Previous school",
  previousClass: "Previous class",
  homeAddress: "Home address",
  religion: "Religion",
  stateOfOrigin: "State of origin",
  medicalNeeds: "Medical needs or allergies",
  secondGuardian: "A second parent or guardian",
};

export const ADMISSION_STANDARD_DOCUMENTS = ["photo", "birthCertificate", "lastReport"] as const;
export type AdmissionStandardDocument = (typeof ADMISSION_STANDARD_DOCUMENTS)[number];

export const ADMISSION_DOCUMENT_LABEL: Record<AdmissionStandardDocument, string> = {
  photo: "Passport photograph",
  birthCertificate: "Birth certificate",
  lastReport: "Last school report or results",
};

/** The upload slot each document is sent and stored under. */
export const admissionDocumentSlotValues = ["PHOTO", "BIRTH_CERTIFICATE", "LAST_REPORT", "CUSTOM_1", "CUSTOM_2", "CUSTOM_3"] as const;
export type AdmissionDocumentSlot = (typeof admissionDocumentSlotValues)[number];
export const ADMISSION_STANDARD_SLOT: Record<AdmissionStandardDocument, AdmissionDocumentSlot> = {
  photo: "PHOTO",
  birthCertificate: "BIRTH_CERTIFICATE",
  lastReport: "LAST_REPORT",
};

export const ADMISSION_LIMITS = {
  intro: 1000,
  offerLetter: 5000,
  customDocuments: 3,
  questions: 5,
  questionLabel: 120,
  choiceOptions: 8,
  choiceOption: 60,
  shortAnswer: 200,
  longAnswer: 1000,
  fieldText: 200,
  /** Applications still open (not closed) from one email to one school. */
  openPerEmail: 3,
  /** SMS alerts to staff per school per Lagos day. */
  smsPerDay: 30,
} as const;

export const admissionQuestionKindValues = ["SHORT", "LONG", "YES_NO", "CHOICE"] as const;
export type AdmissionQuestionKind = (typeof admissionQuestionKindValues)[number];
export const ADMISSION_QUESTION_KIND_LABEL: Record<AdmissionQuestionKind, string> = {
  SHORT: "Short answer",
  LONG: "Long answer",
  YES_NO: "Yes or no",
  CHOICE: "One of a list",
};

const mode = z.enum(admissionFieldModeValues);

export const admissionQuestionSchema = z
  .object({
    id: z.string().regex(/^q[0-9a-z]{1,12}$/),
    label: z.string().trim().min(1, "Write the question.").max(ADMISSION_LIMITS.questionLabel),
    kind: z.enum(admissionQuestionKindValues),
    options: z.array(z.string().trim().min(1).max(ADMISSION_LIMITS.choiceOption)).max(ADMISSION_LIMITS.choiceOptions).default([]),
    required: z.boolean().default(false),
  })
  .refine((q) => q.kind !== "CHOICE" || q.options.length >= 2, { message: "A list needs at least two choices.", path: ["options"] });
export type AdmissionQuestion = z.infer<typeof admissionQuestionSchema>;

export const admissionFormConfigSchema = z.object({
  fields: z.object(Object.fromEntries(ADMISSION_OPTIONAL_FIELDS.map((f) => [f, mode])) as Record<AdmissionOptionalField, typeof mode>),
  documents: z.object({
    photo: mode,
    birthCertificate: mode,
    lastReport: mode,
    custom: z
      .array(z.object({ label: z.string().trim().min(1, "Name the document.").max(60), mode: z.enum(["REQUIRED", "OPTIONAL"]) }))
      .max(ADMISSION_LIMITS.customDocuments),
  }),
  questions: z.array(admissionQuestionSchema).max(ADMISSION_LIMITS.questions),
});
export type AdmissionFormConfig = z.infer<typeof admissionFormConfigSchema>;

/** The form every school starts with (owner, §16.8: documents optional by default). */
export const DEFAULT_ADMISSION_FORM: AdmissionFormConfig = {
  fields: {
    middleName: "OPTIONAL",
    previousSchool: "OPTIONAL",
    previousClass: "OPTIONAL",
    homeAddress: "OPTIONAL",
    religion: "OFF",
    stateOfOrigin: "OFF",
    medicalNeeds: "OPTIONAL",
    secondGuardian: "OFF",
  },
  documents: { photo: "OPTIONAL", birthCertificate: "OPTIONAL", lastReport: "OFF", custom: [] },
  questions: [],
};

/** A stored form, read back safely: anything missing or malformed takes the default. */
export function readAdmissionForm(stored: unknown): AdmissionFormConfig {
  const parsed = admissionFormConfigSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_ADMISSION_FORM;
}

// ─── Settings (owner and admin) ────────────────────────────────────────────

export interface AdmissionSettingsDto {
  enabled: boolean;
  intro: string | null;
  smsAlerts: boolean;
  notifyEmail: string | null;
  offerLetter: string | null;
  form: AdmissionFormConfig;
  classLevels: { id: string; name: string; open: boolean }[];
  /** The address the public form lives at. */
  applyPath: string;
}

export const updateAdmissionSettingsSchema = z.object({
  enabled: z.boolean(),
  intro: z.string().trim().max(ADMISSION_LIMITS.intro).nullable(),
  smsAlerts: z.boolean(),
  notifyEmail: z.string().trim().email("Enter an email address, or leave it empty.").max(254).nullable(),
  offerLetter: z.string().trim().max(ADMISSION_LIMITS.offerLetter).nullable(),
  form: admissionFormConfigSchema,
  closedClassLevelIds: z.array(z.string().uuid()).max(100),
});
export type UpdateAdmissionSettingsInput = z.infer<typeof updateAdmissionSettingsSchema>;

export interface AdmissionOfficerDto {
  id: string;
  name: string;
  /** Their own roles, for telling staff apart ("Teacher", "Bursar"). */
  roles: string[];
  isOfficer: boolean;
}

export const setAdmissionOfficersSchema = z.object({ userIds: z.array(z.string().uuid()).max(20) });
export type SetAdmissionOfficersInput = z.infer<typeof setAdmissionOfficersSchema>;

// ─── The public form ───────────────────────────────────────────────────────

/** What the public page needs to draw the school's form. Nothing private. */
export interface PublicAdmissionFormDto {
  schoolName: string;
  logoUrl: string | null;
  enabled: boolean;
  intro: string | null;
  classLevels: { id: string; name: string }[];
  form: AdmissionFormConfig;
  consentText: string;
}

/** The consent line's wording version, stored with every application. */
export const ADMISSION_CONSENT_VERSION = "2026-10-17";
export function admissionConsentText(schoolName: string): string {
  return (
    `I agree that ${schoolName} may use these details and documents to consider this application. ` +
    "They will be deleted if the application does not lead to admission."
  );
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const phone = z.string().trim().regex(/^\+?[0-9 ]{7,20}$/, "Enter a phone number.");

/**
 * The JSON part of the multipart submission. The files ride alongside it, one
 * per slot. `website` is the honeypot: a person never sees it, so anything in
 * it means a bot.
 */
export const submitAdmissionSchema = z.object({
  classLevelId: z.string().uuid("Choose the class."),
  child: z.object({
    firstName: z.string().trim().min(1, "Enter the child's first name.").max(60),
    middleName: optionalText(60),
    lastName: z.string().trim().min(1, "Enter the child's surname.").max(60),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of birth."),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  }),
  guardian: z.object({
    firstName: z.string().trim().min(1, "Enter your first name.").max(60),
    lastName: z.string().trim().min(1, "Enter your surname.").max(60),
    relationship: z.enum(RELATIONSHIP_VALUES),
    phone,
    email: z.string().trim().email("Enter your email address. The school replies by email.").max(254),
  }),
  secondGuardian: z
    .object({
      firstName: z.string().trim().min(1).max(60),
      lastName: z.string().trim().min(1).max(60),
      relationship: z.enum(RELATIONSHIP_VALUES),
      phone,
      email: optionalText(254),
    })
    .optional(),
  previousSchool: optionalText(ADMISSION_LIMITS.fieldText),
  previousClass: optionalText(60),
  homeAddress: optionalText(ADMISSION_LIMITS.fieldText),
  religion: optionalText(60),
  stateOfOrigin: optionalText(60),
  medicalNeeds: optionalText(ADMISSION_LIMITS.longAnswer),
  answers: z.record(z.string(), z.string().trim().max(ADMISSION_LIMITS.longAnswer)).default({}),
  consent: z.literal(true, { errorMap: () => ({ message: "Tick the consent box to send the application." }) }),
  website: z.string().max(200).optional(),
});
export type SubmitAdmissionInput = z.infer<typeof submitAdmissionSchema>;

export interface SubmitAdmissionResultDto {
  reference: string;
}

// ─── Status ────────────────────────────────────────────────────────────────

export const admissionStatusValues = ["SUBMITTED", "UNDER_REVIEW", "OFFERED", "OFFER_ACCEPTED", "ADMITTED", "REJECTED", "WITHDRAWN"] as const;
export type AdmissionStatus = (typeof admissionStatusValues)[number];

/** For the school's own screens. */
export const ADMISSION_STATUS_LABEL: Record<AdmissionStatus, string> = {
  SUBMITTED: "New",
  UNDER_REVIEW: "Under review",
  OFFERED: "Offered",
  OFFER_ACCEPTED: "Offer accepted",
  ADMITTED: "Admitted",
  REJECTED: "Not successful",
  WITHDRAWN: "Withdrawn",
};

/** For the family, in words. */
export const ADMISSION_STATUS_FAMILY_LABEL: Record<AdmissionStatus, string> = {
  SUBMITTED: "Received. The school will be in touch.",
  UNDER_REVIEW: "The school is reviewing the application.",
  OFFERED: "The school has offered a place.",
  OFFER_ACCEPTED: "You have accepted the offer. The school will complete admission.",
  ADMITTED: "Admitted.",
  REJECTED: "The application was not successful.",
  WITHDRAWN: "The application was withdrawn.",
};

export interface AdmissionTrackDto {
  schoolName: string;
  reference: string;
  childFirstName: string;
  classLevel: string;
  status: AdmissionStatus;
  statusLabel: string;
  submittedAt: string | Date;
  /** CP7.2. */
  decision: AdmissionTrackDecisionDto;
}

// ─── The school's list ─────────────────────────────────────────────────────

export const listAdmissionsSchema = z.object({
  status: z.enum(admissionStatusValues).optional(),
  classLevelId: z.string().uuid().optional(),
});
export type ListAdmissionsInput = z.infer<typeof listAdmissionsSchema>;

export interface AdmissionListItemDto {
  id: string;
  reference: string;
  childName: string;
  dateOfBirth: string;
  gender: "MALE" | "FEMALE" | "OTHER";
  classLevel: string;
  guardianName: string;
  guardianPhone: string;
  status: AdmissionStatus;
  submittedAt: string | Date;
  documents: number;
}

export interface AdmissionListDto {
  items: AdmissionListItemDto[];
  counts: Record<AdmissionStatus, number>;
}

export interface AdmissionDocumentDto {
  id: string;
  slot: AdmissionDocumentSlot;
  label: string;
  ext: string;
  sizeBytes: number;
}

export interface AdmissionDetailDto extends AdmissionListItemDto {
  childFirstName: string;
  childLastName: string;
  guardian: { firstName: string; lastName: string; relationship: string; phone: string; email: string };
  /** The optional fields and the school's own questions, as answered, with their labels. */
  details: { label: string; value: string }[];
  secondGuardian: { name: string; relationship: string; phone: string; email: string | null } | null;
  documentFiles: AdmissionDocumentDto[];
  consentAt: string | Date;
  statusChangedAt: string | Date;
  /** CP7.2. */
  decision: AdmissionDecisionDto;
}

// ─── CP7.2: review, assessment, offer and admitting ────────────────────────

export const admissionAssessmentKindValues = ["ENTRANCE_EXAM", "INTERVIEW", "ONLINE", "OTHER"] as const;
export type AdmissionAssessmentKind = (typeof admissionAssessmentKindValues)[number];
export const ADMISSION_ASSESSMENT_LABEL: Record<AdmissionAssessmentKind, string> = {
  ENTRANCE_EXAM: "Entrance exam",
  INTERVIEW: "Interview",
  ONLINE: "Online assessment",
  OTHER: "Assessment",
};

/** Applications still being decided; the only ones a family or the school can withdraw. */
export const ADMISSION_OPEN_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "OFFERED", "OFFER_ACCEPTED"] as const;

const lagosDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date.");
const lagosTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the time as HH:MM.");

/** Book (or change) the assessment. Moves a new application to Under review. */
export const bookAdmissionAssessmentSchema = z.object({
  kind: z.enum(admissionAssessmentKindValues),
  day: lagosDay,
  time: lagosTime,
  note: optionalText(1000),
});
export type BookAdmissionAssessmentInput = z.infer<typeof bookAdmissionAssessmentSchema>;

/** Offer a place, with the letter the family will see in full. */
export const offerAdmissionSchema = z.object({
  letter: z.string().trim().min(1, "Write the offer letter.").max(5000),
});
export type OfferAdmissionInput = z.infer<typeof offerAdmissionSchema>;

/** Not successful. The note is sent to the family only when typed. */
export const rejectAdmissionSchema = z.object({
  note: optionalText(1000),
});
export type RejectAdmissionInput = z.infer<typeof rejectAdmissionSchema>;

/** The school records that the family accepted (by phone or in person). */
export const recordAdmissionAcceptanceSchema = z.object({
  familySawLetter: z.literal(true, { errorMap: () => ({ message: "Confirm the family has seen the full offer letter." }) }),
});
export type RecordAdmissionAcceptanceInput = z.infer<typeof recordAdmissionAcceptanceSchema>;

/** Admit: create the student and place them in a class. */
export const admitApplicationSchema = z.object({
  termId: z.string().uuid("Choose the term."),
  classArmId: z.string().uuid("Choose the class."),
  admissionNumber: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type AdmitApplicationInput = z.infer<typeof admitApplicationSchema>;

export interface AdmitApplicationResultDto {
  studentId: string;
  admissionNumber: string;
  guardianId: string;
  /** True when the parent was already a guardian at the school (a sibling's). */
  linkedExistingGuardian: boolean;
}

/** What the application page needs for its actions. */
export interface AdmissionDecisionDto {
  assessment: { kind: AdmissionAssessmentKind; label: string; day: string; time: string; note: string | null } | null;
  offerLetter: string | null;
  offeredAt: string | Date | null;
  acceptedAt: string | Date | null;
  /** "the family, online" or the staff member's name. */
  acceptedBy: string | null;
  decisionNote: string | null;
  admittedAt: string | Date | null;
  student: { id: string; name: string; admissionNumber: string } | null;
  /** Students at the school with the same names and date of birth. Never blocks. */
  possibleDuplicates: { id: string; name: string; admissionNumber: string; status: string }[];
  /** A guardian at the school with the parent's email; Admit links them. */
  existingGuardian: { id: string; name: string; phone: string } | null;
  /** The school's default offer letter, for a new offer. */
  defaultOfferLetter: string | null;
}

/** The tracking page, CP7.2: what the family sees and may do. */
export interface AdmissionTrackDecisionDto {
  assessment: { label: string; day: string; time: string; note: string | null } | null;
  offerLetter: string | null;
  acceptedAt: string | Date | null;
  decisionNote: string | null;
  canAccept: boolean;
  canWithdraw: boolean;
}

/** A student's admission documents, on the student page (owner, admin). */
export interface StudentAdmissionDocumentsDto {
  applicationId: string;
  reference: string;
  admittedAt: string | Date | null;
  documents: AdmissionDocumentDto[];
}
