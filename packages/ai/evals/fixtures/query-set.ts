// The labelled query set CP4 measures retrieval against.
//
// ============================================================================
// PROVENANCE IS THE MOST IMPORTANT THING IN THIS FILE (phase-7.md D22).
// ============================================================================
//
// A suite whose queries, corpus and scorer all come from the same author
// measures internal consistency, not quality. It can score 100% and mean
// nothing. So this file carries an explicit provenance marker, the eval case
// READS it, and the case's gating severity and output banner both change with
// it. That is deliberate: the limitation is enforced by the code rather than
// remembered by a person.
//
// While provenance is "author-generated", the suite:
//   * reports every check at WARN rather than error, so a green run cannot be
//     mistaken for a passing gate; and
//   * emits a permanently-failing warn line saying CP4 IS NOT CLOSED.
//
// Swapping in a real teacher's queries is what flips both. Nothing else does.
//
// -- Why the author's own queries are weak evidence, concretely --------------
// CP3's live check used "consonants sheep chip fish pitch", which quotes the
// source document almost verbatim. That is easy BY CONSTRUCTION: the query and
// the chunk share rare tokens, so almost any embedding model would match them.
// A teacher would more likely type "pronunciation practice" — no shared
// vocabulary, and the honest test of whether the embedding understands the
// topic rather than echoing it.
//
// The placeholders below therefore deliberately PARAPHRASE rather than quote.
// That makes them harder than CP3's, and still not good enough: I am guessing
// at how a teacher phrases things, and I chose the correct answers myself,
// which is the circularity D22 exists to break.

/** Where the queries came from. Drives gating severity — see the header. */
export type QuerySetProvenance = "author-generated" | "teacher-supplied";

/**
 * CHANGE THIS to "teacher-supplied" only when the queries below have been
 * replaced by ones a real teacher wrote AND labelled. Changing it without
 * replacing them defeats the entire mechanism.
 */
export const QUERY_SET_PROVENANCE: QuerySetProvenance = "author-generated";

/** Free-text note shown in the suite output, so provenance is never invisible. */
export const QUERY_SET_NOTE =
  "Placeholder queries written by the implementer (2026-09-04). Requested from a " +
  "real Virgo Fidelis teacher via Arinzechukwu; not yet received.";

export interface LabelledQuery {
  /** What a teacher types into the lesson-plan topic field. */
  readonly query: string;
  /**
   * The week(s) whose chunk would be a correct answer, as they appear in the
   * heading path — e.g. ["WEEK 3"]. Null means NOTHING in this corpus should
   * match and the distance floor is expected to reject every candidate.
   *
   * A LIST, not a single value, because real schemes repeat topics: this one
   * runs a debate in both week 7 and week 9, and calling either "the" answer
   * would score correct retrieval as a miss. Found by running the suite — my
   * first version labelled only week 7 and the eval reported a failure that
   * was mine, not the retrieval's. Exactly the labelling error D22 predicts an
   * author makes about their own corpus.
   */
  readonly expectedWeeks: readonly string[] | null;
  /** Why this query is here — what it is trying to catch. */
  readonly rationale: string;
}

/**
 * Queries against the JSS3 English scheme of work fixture.
 *
 * The negative cases are the weakest part and the most important to replace.
 * "simultaneous linear equations" shares no vocabulary with an English scheme
 * at all, which makes rejection trivial. The case that would genuinely stress
 * the distance floor is a NEAR MISS inside the same subject — a topic the
 * school teaches in a different term, or an English topic this scheme happens
 * not to cover. A teacher can name those; I can only guess at them.
 */
export const QUERY_SET: readonly LabelledQuery[] = [
  {
    query: "words that describe how often something happens",
    expectedWeeks: ["WEEK 3"],
    rationale:
      "Paraphrase of 'Adverbs of Frequency' with NO shared vocabulary — tests whether " +
      "the embedding understands the topic rather than matching rare tokens.",
  },
  {
    query: "writing a letter to a friend about the new session",
    expectedWeeks: ["WEEK 1"],
    rationale: "Close to the document's own wording; a comparatively easy case, kept as a baseline.",
  },
  {
    query: "teaching pupils to find the main idea quickly without reading every word",
    expectedWeeks: ["WEEK 2"],
    rationale:
      "Paraphrase of 'Skimming for Specific Information'. Deliberately describes the " +
      "technique instead of naming it.",
  },
  {
    query: "pronunciation practice for pairs of similar sounds",
    expectedWeeks: ["WEEK 8"],
    rationale:
      "The query CP3's check SHOULD have used. CP3 asked 'consonants sheep chip fish " +
      "pitch', quoting the document; this names the pedagogical goal instead.",
  },
  {
    query: "class debate on a social issue",
    expectedWeeks: ["WEEK 7", "WEEK 9"],
    rationale:
      "The scheme runs a debate in BOTH week 7 (corruption) and week 9 (child " +
      "trafficking), so either is correct. Originally labelled week 7 only, which the " +
      "eval reported as a miss when it returned week 9 — a mislabelling by the author, " +
      "not a retrieval failure, and a small live demonstration of why D22 exists.",
  },
  {
    query: "introducing the parts of speech at the start of term",
    expectedWeeks: ["WEEK 1"],
    rationale: "Grammar revision in week 1. Tests a sub-row rather than the week's first cell.",
  },
  {
    query: "simultaneous linear equations and factorisation",
    expectedWeeks: null,
    rationale:
      "NEGATIVE — Mathematics against an English corpus. WEAK by construction: no shared " +
      "vocabulary makes rejection easy. Replace with a same-subject near-miss.",
  },
  {
    query: "the causes of the Nigerian civil war",
    expectedWeeks: null,
    rationale:
      "NEGATIVE — History. Slightly harder than the Mathematics case (prose subject, " +
      "shared register) but still a different subject entirely.",
  },
];
