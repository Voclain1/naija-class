import { z } from "zod";

// Data protection: the legal pages, the consent wording people agree to and
// its versions, and the letter schools send parents
// (docs/modules/data-protection.md, 2026-10-25).
//
// A wording change that alters what someone agrees to gets a new version. The
// product then asks school owners and parents to confirm again: a record says
// which words were agreed to, not only that something was.

/** The public legal pages, on the SchoolKit marketing site. */
export const LEGAL_URLS = {
  privacy: "https://schoolkit.ng/privacy-policy",
  terms: "https://schoolkit.ng/terms-of-service",
  dataProcessing: "https://schoolkit.ng/data-processing-agreement",
  cookies: "https://schoolkit.ng/cookies",
  refunds: "https://schoolkit.ng/refund-policy",
  deleteAccount: "https://schoolkit.ng/delete-account",
} as const;

// ─── School owner ───────────────────────────────────────────────────────────

export const SCHOOL_CONSENT_VERSION = "2026-10-25";

/** What the owner confirms at sign-up, at setup step 4 and in Settings. */
export const SCHOOL_CONSENT_POINTS = [
  "I am authorised to set up SchoolKit for this school.",
  "The school will get each parent's or guardian's consent before putting a child's details into SchoolKit, and explicit consent before recording health information.",
  "The school will tell parents and staff that it uses SchoolKit.",
  "I accept the Terms of Service and the Data Processing Agreement, and I have read the Privacy Policy.",
] as const;

export const confirmSchoolDataProtectionSchema = z
  .object({ confirm: z.literal(true, { errorMap: () => ({ message: "Tick the box to confirm." }) }) })
  .strict();
export type ConfirmSchoolDataProtectionInput = z.infer<typeof confirmSchoolDataProtectionSchema>;

/** GET /schools/me/data-protection */
export interface SchoolDataProtectionDto {
  confirmedAt: string | null;
  /** Null: confirmed before versions were kept. */
  version: string | null;
  confirmedByName: string | null;
  currentVersion: string;
  /** True when the owner has confirmed the current wording. */
  current: boolean;
}

// ─── Parent ─────────────────────────────────────────────────────────────────

export const PARENT_CONSENT_VERSION = "2026-10-25";

export const guardianConsentSchema = z
  .object({ consent: z.literal(true, { errorMap: () => ({ message: "Tick the box to continue." }) }) })
  .strict();
export type GuardianConsentInput = z.infer<typeof guardianConsentSchema>;

/** GET /portal/me/consent */
export interface GuardianConsentDto {
  acceptedAt: string | null;
  version: string | null;
  currentVersion: string;
  /** False: show the consent screen before anything else. */
  current: boolean;
}

/** True when a recorded version is the one in force now. */
export function isCurrentConsent(version: string | null | undefined, current: string): boolean {
  return version === current;
}

// ─── The letter to parents ──────────────────────────────────────────────────

export interface ParentNoticeInput {
  schoolName: string;
  schoolEmail?: string | null;
  schoolPhone?: string | null;
  /** Where the school's parents sign in. */
  parentsUrl?: string | null;
}

/**
 * The notice a school sends parents: it uses SchoolKit, what it holds and
 * why, who can see it, and how to ask questions or say no. Plain text, so
 * it can be printed, emailed, or pasted into a WhatsApp group.
 */
export function parentNoticeLetter(input: ParentNoticeInput): string {
  const contact = [input.schoolEmail, input.schoolPhone].filter(Boolean).join(" or ");
  const contactLine = contact ? `the school office (${contact})` : "the school office";
  const lines = [
    "Dear Parent or Guardian,",
    "",
    `How ${input.schoolName} looks after your child's information`,
    "",
    `${input.schoolName} uses SchoolKit, a school management system, to keep student records and to keep in touch with families.`,
    "",
    "What we keep: your child's name, class, date of birth and photo; attendance, results and report cards; fees and payments; and, where you give it to us, health information such as allergies, medicines and vaccinations so we can care for your child at school. We also keep your name, phone number and email so we can contact you.",
    "",
    "Why: to teach and care for your child, to keep you informed about their progress, attendance and fees, and to run the school.",
    "",
    "Who can see it: only staff who need it for their work, and you. SchoolKit stores the information for us, keeps it secure, and does not sell it or use it for advertising. It is never shared with other schools.",
    "",
    `Your choices: you can ask to see or correct your child's information, or ask questions about how we use it, at any time. Health information is recorded only with your agreement. Please contact ${contactLine}.`,
    "",
    input.parentsUrl
      ? `You can see your child's results, fees and school news on the parents' site: ${input.parentsUrl}`
      : "You can see your child's results, fees and school news on the SchoolKit parents' site or app once the school invites you.",
    "",
    `SchoolKit's privacy policy: ${LEGAL_URLS.privacy}`,
    "",
    "Please sign and return the slip below.",
    "",
    "----------------------------------------",
    "",
    `I agree that ${input.schoolName} may keep my child's information in SchoolKit as described above.`,
    "",
    "I agree that the school may record my child's health information (allergies, medicines, vaccinations, sickbay visits):   Yes  /  No",
    "",
    "Child's name: ______________________   Class: __________",
    "",
    "Parent or guardian: ______________________",
    "",
    "Signature: ______________________   Date: __________",
  ];
  return lines.join("\n");
}
