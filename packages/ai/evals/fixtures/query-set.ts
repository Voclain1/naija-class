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
  "PARTIALLY teacher-sourced (2026-09-04). Two items arrived from a real Virgo Fidelis " +
  "English teacher and are in use: the within-subject negative ('university-level academic " +
  "research paper with APA citations') and the week label for the parts-of-speech query. " +
  "ALL SIX POSITIVE QUERIES ARE STILL THE IMPLEMENTER'S OWN WORDING - the teacher's positive " +
  "topics have not been received. Provenance therefore stays 'author-generated': the positives " +
  "are what the gate scores, and they are still author-written.";

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
 * NEGATIVES — RESOLVED 2026-09-04, and worth recording how.
 *
 * The two cross-subject negatives are trivially easy by construction: neither
 * Mathematics nor History shares vocabulary with an English scheme, so no
 * plausible floor could fail them. The case that genuinely stresses the floor
 * is a near miss INSIDE the subject, and a teacher supplied one.
 *
 * The first candidate considered was "parts of speech in third term" — which
 * looked like an ideal within-subject negative and is in fact a strong
 * POSITIVE: the scheme reviews all eight parts of speech across Third Term
 * weeks 2, 3 and 4. Filed as a negative it would have asserted the opposite of
 * the truth, and since negatives are GATED, it would have failed correct
 * retrieval — or pushed the floor down to "fix" it. Caught only by checking the
 * fixture rather than trusting the label. Third confirmed instance of an author
 * mislabelling this corpus (after the week 7/9 debate and the unsatisfiable
 * precision metric), and the clearest argument yet for verifying every label
 * against the source, including a teacher's.
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
    rationale:
      "Grammar revision in First Term week 1 ('Parts of speech - Revision'). Tests a sub-row " +
      "rather than the week's first cell, and currently MISSES - the week-1 chunk ranks below " +
      "five other weeks. Deliberately not tuned away. " +
      "LABEL IS TEACHER-CONFIRMED (2026-09-04): parts of speech also appears in Third Term " +
      "weeks 2-4 (nouns/pronouns, verbs/adverbs, adjectives/conjunctions/prepositions/" +
      "interjections), so 'at the start of term' was ambiguous across four candidate weeks. " +
      "The teacher confirmed First Term week 1. The QUERY WORDING is still the author's; only " +
      "the label came from the teacher.",
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
  {
    query: "writing a university-level academic research paper with APA citations",
    expectedWeeks: null,
    rationale:
      "NEGATIVE — TEACHER-SUPPLIED (2026-09-04), and the only within-subject negative in the " +
      "set: English writing instruction, wrong level and context entirely. This is the case " +
      "D22 said the floor actually needs, and it is a genuine LEXICAL TRAP rather than a " +
      "far-away topic. Verified against the fixture: the scheme has no research-paper, source, " +
      "bibliography or citation-format content anywhere, but it DOES contain three near " +
      "neighbours this query can collide with - First Term week 3's 'Reading to cultivate the " +
      "skill of referencing' (a comprehension skill, not academic citation), Third Term week " +
      "3's 'Review of Argumentative / Expository Essay' (the closest legitimate writing " +
      "neighbour), and First Term week 1's 'my plan for the academic session'. If the floor is " +
      "too loose, this leaks; the cross-subject negatives above never could.",
  },
];
