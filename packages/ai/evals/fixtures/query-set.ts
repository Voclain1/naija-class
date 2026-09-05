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
// The set is MIXED, and every query says where it came from. Aggregate scores
// over a mixed set are misleading, so the eval reports each band separately —
// see `QuerySource` below.

/**
 * Where the SET as a whole came from. Drives gating severity and the banner.
 *
 * - `author-generated` — every query is the implementer's own wording.
 * - `document-derived` — positives are quoted verbatim from the verified
 *   curriculum document, so their week labels are ground truth. The phrasing
 *   is the DOCUMENT'S, not a teacher's, and is therefore easy by construction
 *   (see `document-verbatim` below). Not independently phrased.
 * - `teacher-phrased` — the queries are a real teacher's own wording, but their
 *   WEEK LABELS came from verifying each topic against the source document,
 *   because the teacher's own week claims were checked and were wrong. This is
 *   the honest description of the current set, and it is deliberately NOT
 *   `teacher-supplied`: D22 asked for topics AND labels from a teacher, and
 *   only half of that arrived.
 * - `teacher-supplied` — the positive queries were written AND labelled by a
 *   real teacher, with the labels holding up against the document. This is the
 *   only value under which CP4's original claim is fully established.
 */
export type QuerySetProvenance =
  | "author-generated"
  | "document-derived"
  | "teacher-phrased"
  | "teacher-supplied";

/**
 * CHANGE THIS only to match what the queries below actually are. Setting it to
 * a stronger value than the queries justify defeats the entire mechanism —
 * that is the one failure this file cannot detect for itself.
 */
export const QUERY_SET_PROVENANCE: QuerySetProvenance = "teacher-phrased";

/** Free-text note shown in the suite output, so provenance is never invisible. */
export const QUERY_SET_NOTE =
  "MIXED provenance, honestly mixed (2026-09-05). FIVE queries are a real Virgo Fidelis " +
  "teacher's OWN WORDING — the independently-phrased input CP4 waited for. Their WEEK " +
  "LABELS are NOT the teacher's: all five claimed weeks were checked against the source " +
  "document and ALL FIVE WERE WRONG (0/5), so the labels here come from fixture " +
  "verification instead. Two of the five turned out not to be in the scheme at all and are " +
  "now the set's best negatives. That is why this is teacher-PHRASED, not teacher-supplied. " +
  "14 further positives are quoted VERBATIM from the " +
  "verified JSS3 English scheme, so their week labels are ground truth but their phrasing is " +
  "the document's own and matches the corpus lexically — easy by construction, and a plumbing " +
  "check rather than a test of semantic retrieval. 6 positives are the implementer's own " +
  "paraphrases: harder, and the only semantic signal here, but unvalidated guesses at how a " +
  "teacher phrases things. 1 negative is genuinely TEACHER-SOURCED and is the single most " +
  "informative item in the set. THREE positives are now teacher-WRITTEN, but none is " +
  "teacher-LABELLED, which is why the CP4-IS-NOT-CLOSED banner still fails: D22 asked for " +
  "topics and labels, and the labels did not survive verification. Scores are reported per " +
  "band because an aggregate over these four is "
  "meaningless. THE NUMBERS ARE ALSO PROVISIONAL FOR A SECOND, SEPARATE REASON: the JSS3 " +
  "corpus has NOT been re-ingested since CP3 began embedding headings together with " +
  "content (D15), so the corpus this suite scores against may not be embedded the way " +
  "production is. Unconfirmed as of 2026-09-04 — not verified either way.";

/**
 * Where an individual query came from. The eval reports each band separately,
 * because a document-verbatim pass and an author-paraphrase pass are not
 * comparable evidence and averaging them hides which is carrying the score.
 */
export type QuerySource =
  /**
   * Quoted verbatim from the curriculum document. The week label is GROUND
   * TRUTH — no author judgement enters it, which is this band's whole value.
   *
   * But the query shares its exact tokens with the target chunk, so a hit
   * demonstrates that the pipeline is wired up, NOT that the embedding
   * understands the topic. Treat this band as a regression/plumbing check.
   * Chosen deliberately (2026-09-04) over author-rephrasing the document's
   * text: rephrasing would have been the author guessing at natural phrasing
   * again, which is the exact circularity D22 exists to break, and two prior
   * labelling errors already came from confident-but-wrong author assumptions.
   */
  | "document-verbatim"
  /**
   * The implementer's paraphrase. Harder than verbatim and the only band that
   * tests semantics — but it is a GUESS at how a teacher phrases things, by
   * the same person who wrote the corpus handling, the retrieval and this
   * scorer. Kept, clearly labelled, because removing it would leave the suite
   * with no semantic signal at all.
   */
  | "author-paraphrase"
  /** Written by a real Virgo Fidelis English teacher. The gold standard. */
  | "teacher";

export interface LabelledQuery {
  /** What goes into the lesson-plan topic field. */
  readonly query: string;
  /**
   * The FULL heading path(s) that would be a correct answer — e.g.
   * ["First Term > WEEK 3"]. Null means nothing in this corpus should match
   * and the distance floor is expected to reject every candidate.
   *
   * FULL PATHS, not bare week numbers, and matched by EQUALITY not substring.
   * This corpus has three `WEEK 2`s and two `WEEK 1`s across terms, so a bare
   * "WEEK 2" label silently accepts the wrong term's chunk as a hit. That was
   * a real latent false-pass in the placeholder set — "teaching pupils to find
   * the main idea" matched at rank 3 on First Term > WEEK 2 while Second and
   * Third Term > WEEK 2 sat in the same corpus; it passed for the right reason
   * by luck, not by construction. Found when the document-derived positives
   * (which span all three terms) made the collision unavoidable.
   *
   * A LIST because real schemes repeat topics: this one runs a debate in both
   * First Term week 7 and week 9. My first version labelled only week 7 and
   * the eval reported a failure that was mine, not the retrieval's.
   */
  readonly expectedWeeks: readonly string[] | null;
  /** Which evidence band this query belongs to. */
  readonly source: QuerySource;
  /** Why this query is here — what it is trying to catch. */
  readonly rationale: string;
}

/**
 * NEGATIVES — the teacher's is the one that matters.
 *
 * The two cross-subject negatives are trivially easy by construction: neither
 * Mathematics nor History shares vocabulary with an English scheme, so no
 * plausible floor could fail them. They are retained as a sanity floor, not as
 * evidence. The teacher's within-subject negative rejects at 0.7209 — a 0.031
 * margin where those two sit at 0.12 — and is what collapsed D23's separation
 * gap from 0.1302 to 0.0415. See phase-7.md §14.7.
 *
 * NO document-derived negatives, deliberately. A correct rejection cannot be
 * derived from a document that does not contain the topic, and the attempt is
 * actively dangerous: the first candidate for a within-subject negative,
 * "parts of speech in third term", is in fact a strong POSITIVE — the scheme
 * reviews all eight parts of speech across Third Term weeks 2-4. Filed as a
 * GATED negative it would have failed correct retrieval, or pressured the
 * floor downward to "fix" it.
 */
export const QUERY_SET: readonly LabelledQuery[] = [
  // ---- band 1: document-verbatim (ground-truth labels, easy phrasing) ------
  {
    query: "Parts of speech – Revision",
    expectedWeeks: ["First Term > WEEK 1"],
    source: "document-verbatim",
    rationale: "GRAMMAR row, First Term week 1. Verbatim.",
  },
  {
    query: "Skimming for Specific Information",
    expectedWeeks: ["First Term > WEEK 2"],
    source: "document-verbatim",
    rationale: "READING AND COMPREHENSION row. Verbatim.",
  },
  {
    query: "Adverbs of Frequency – (often, always, occasionally)",
    expectedWeeks: ["First Term > WEEK 3"],
    source: "document-verbatim",
    rationale: "GRAMMAR row. Verbatim, including the document's own examples.",
  },
  {
    query: "Changing positive statements to negative statements using 'not'",
    expectedWeeks: ["First Term > WEEK 4"],
    source: "document-verbatim",
    rationale: "GRAMMAR row. Verbatim.",
  },
  {
    query: "Modal Forms – will, can, could, may, Direct and Indirect Forms of Modals",
    expectedWeeks: ["First Term > WEEK 5"],
    source: "document-verbatim",
    rationale: "GRAMMAR row. Verbatim.",
  },
  {
    query: "Reading to make deductions from a selected passage",
    expectedWeeks: ["First Term > WEEK 6"],
    source: "document-verbatim",
    rationale: "READING AND COMPREHENSION row. Verbatim.",
  },
  {
    query: "Adverbs of place and manner",
    expectedWeeks: ["First Term > WEEK 7"],
    source: "document-verbatim",
    rationale:
      "GRAMMAR row. Verbatim. Note the corpus holds four other adverb topics (frequency, " +
      "cause/reason, adjectives+adverbs, and a Third Term review), so this is the least " +
      "distinctive of the verbatim band.",
  },
  {
    query: "Idiomatic Expressions",
    expectedWeeks: ["First Term > WEEK 8"],
    source: "document-verbatim",
    rationale: "GRAMMAR row. Verbatim, and unique in the corpus.",
  },
  {
    query: "Identification of the topic sentence a given passage",
    expectedWeeks: ["First Term > WEEK 9"],
    source: "document-verbatim",
    rationale: "READING AND COMPREHENSION row. Verbatim, including the document's own typo.",
  },
  {
    query: "Reading for Critical Evaluation",
    expectedWeeks: ["Second Term > WEEK 1"],
    source: "document-verbatim",
    rationale: "READING AND COMPREHENSION row. Verbatim. First of only two Second Term weeks.",
  },
  {
    query: "Prepositions which express relations with people (with, for, against)",
    expectedWeeks: ["Second Term > WEEK 2"],
    source: "document-verbatim",
    rationale:
      "GRAMMAR row. Verbatim. Collides semantically with Third Term week 4's preposition " +
      "review, which is a genuine cross-term test.",
  },
  {
    query: "Review of Nouns and Pronouns",
    expectedWeeks: ["Third Term > WEEK 2"],
    source: "document-verbatim",
    rationale: "ENGLISH STRUCTURE row. Verbatim.",
  },
  {
    query: "Review of Argumentative / Expository Essay",
    expectedWeeks: ["Third Term > WEEK 3"],
    source: "document-verbatim",
    rationale:
      "COMPOSITION row. Verbatim. This is the nearest legitimate neighbour to the teacher's " +
      "APA negative, so a hit here alongside that rejection is a meaningful pair.",
  },
  {
    query: "Review of Adjectives, Conjunctions, Prepositions and Interjections",
    expectedWeeks: ["Third Term > WEEK 4"],
    source: "document-verbatim",
    rationale: "ENGLISH STRUCTURE row. Verbatim.",
  },

  // ---- band 2: author-paraphrase (harder, but the author's guesses) -------
  {
    query: "words that describe how often something happens",
    expectedWeeks: ["First Term > WEEK 3"],
    source: "author-paraphrase",
    rationale:
      "Paraphrase of 'Adverbs of Frequency' with NO shared vocabulary — the semantic pair to " +
      "the verbatim version of the same row.",
  },
  {
    query: "writing a letter to a friend about the new session",
    expectedWeeks: ["First Term > WEEK 1"],
    source: "author-paraphrase",
    rationale: "Close to the document's own wording; a comparatively easy case, kept as a baseline.",
  },
  {
    query: "teaching pupils to find the main idea quickly without reading every word",
    expectedWeeks: ["First Term > WEEK 2"],
    source: "author-paraphrase",
    rationale:
      "Paraphrase of 'Skimming for Specific Information'. Describes the technique instead of " +
      "naming it. The label that exposed the bare-week-number false-pass risk.",
  },
  {
    query: "pronunciation practice for pairs of similar sounds",
    expectedWeeks: ["First Term > WEEK 8"],
    source: "author-paraphrase",
    rationale:
      "The query CP3's check SHOULD have used. CP3 asked 'consonants sheep chip fish pitch', " +
      "quoting the document; this names the pedagogical goal instead.",
  },
  {
    query: "class debate on a social issue",
    expectedWeeks: ["First Term > WEEK 7", "First Term > WEEK 9"],
    source: "author-paraphrase",
    rationale:
      "The scheme runs a debate in BOTH week 7 (corruption) and week 9 (child trafficking). " +
      "Originally labelled week 7 only, which the eval reported as a miss when it returned " +
      "week 9 — a mislabelling by the author, not a retrieval failure.",
  },
  {
    query: "introducing the parts of speech at the start of term",
    expectedWeeks: ["First Term > WEEK 1"],
    source: "author-paraphrase",
    rationale:
      "Currently MISSES — the week-1 chunk ranks below five other weeks. Deliberately not " +
      "tuned away. LABEL IS TEACHER-CONFIRMED (2026-09-04): parts of speech also appears in " +
      "Third Term weeks 2-4, so 'at the start of term' was ambiguous across four candidate " +
      "weeks. The teacher confirmed First Term week 1. The WORDING is still the author's.",
  },

  // ---- band 2b: TEACHER-PHRASED positives (2026-09-05) --------------------
  //
  // A real Virgo Fidelis English teacher supplied five topics in their own
  // words. This is the independently-phrased input D22 has wanted since CP3 —
  // and note the SHAPE of it, which no author guessed: every one is framed as
  // "lesson note on X for JSS3", not as a bare topic. That frame turns out to
  // be the likeliest cause of the retrieval failures in phase-7.md §17.1,
  // because it matches an entire scheme of work regardless of topic.
  //
  // THE LABELS ARE NOT THEIRS. All five claimed weeks were checked against the
  // source document and all five were wrong — not marginally: two of the topics
  // are not in the scheme in ANY week. The labels below therefore come from
  // fixture verification, which is why the set is `teacher-phrased` rather than
  // `teacher-supplied`. Recorded because it is the strongest evidence in this
  // whole exercise that EVERY label gets verified against the source no matter
  // who supplies it — including a teacher who teaches the subject daily.
  {
    query: "JSS3 comprehension lesson on identifying main ideas",
    expectedWeeks: ["First Term > WEEK 1", "First Term > WEEK 9"],
    source: "teacher",
    rationale:
      "TEACHER-PHRASED. Claimed week 3; week 3's comprehension row is actually 'Reading to " +
      "cultivate the skill of referencing'. Main ideas are First Term W1 ('Scanning for main " +
      "points') and W9 ('Identification of the topic sentence'). Retrieval returns W9 first " +
      "at 0.5979 — correct against the VERIFIED label, a miss against the teacher's.",
  },
  {
    query: "Lesson note on simile, metaphor and personification",
    expectedWeeks: ["Third Term > WEEK 3"],
    source: "teacher",
    rationale:
      "TEACHER-PHRASED. Claimed week 5; the literary terms are Third Term week 3 ('Metaphor, " +
      "Simile, Alliteration, Irony'). Personification appears NOWHERE in the scheme, which a " +
      "teacher searching for it cannot know. Retrieved correctly at 0.5247, the best margin in " +
      "the whole set.",
  },
  {
    query: "How to write a formal letter for JSS3",
    expectedWeeks: ["Third Term > WEEK 4", "First Term > WEEK 5"],
    source: "teacher",
    rationale:
      "TEACHER-PHRASED, and the set's most valuable POSITIVE because it MISSES. Claimed week 4 " +
      "— correct only if Third Term was meant; First Term week 4 is 'How to care for a motor " +
      "vehicle'. Formal letters are Third Term W4 and First Term W5. Retrieval keeps just ONE " +
      "chunk at 0.6641 and it is the front-matter 'First Term' block, not either real week. A " +
      "genuine topic, genuinely present, genuinely not found — and lost to a junk chunk that " +
      "CP5's review gate now lets a teacher discard.",
  },

  // ---- band 3: negatives --------------------------------------------------
  {
    query: "simultaneous linear equations and factorisation",
    expectedWeeks: null,
    source: "author-paraphrase",
    rationale:
      "NEGATIVE — Mathematics against an English corpus. WEAK by construction: no shared " +
      "vocabulary makes rejection easy. Retained as a sanity floor, not as evidence.",
  },
  {
    query: "the causes of the Nigerian civil war",
    expectedWeeks: null,
    source: "author-paraphrase",
    rationale:
      "NEGATIVE — History. Slightly harder than the Mathematics case (prose subject, shared " +
      "register) but still a different subject entirely.",
  },
  {
    query: "writing a university-level academic research paper with APA citations",
    expectedWeeks: null,
    source: "teacher",
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
      "too loose, this leaks; the cross-subject negatives above never could. " +
      "DO NOT REPLACE OR DILUTE — this single query collapsed D23's measured separation gap " +
      "from 0.1302 to 0.0415 and is the most informative item in the file.",
  },
  {
    query: "Lesson note on direct and indirect speech for JSS3",
    expectedWeeks: null,
    source: "teacher",
    rationale:
      "NEGATIVE, TEACHER-PHRASED (2026-09-05) — and it CURRENTLY LEAKS at 0.5678, deep inside " +
      "the 0.69 floor and CLOSER than three genuine positives. The teacher offered it as a " +
      "week-2 positive; reported speech appears nowhere in this scheme. The only 'direct/" +
      "indirect' in the document is First Term week 5's 'Direct and Indirect Forms of MODALS', " +
      "a false friend. Left failing on purpose: this is the case that disproved both the " +
      "absolute floor and D23's relative rule (phase-7.md §17.1).",
  },
  {
    query: "JSS3 summary writing lesson note with examples",
    expectedWeeks: null,
    source: "teacher",
    rationale:
      "NEGATIVE, TEACHER-PHRASED (2026-09-05) — LEAKS at 0.6018 with all five slots filled. " +
      "'Summary', 'summarise' and 'summarize' occur ZERO times in the corpus, which is what " +
      "makes this the sharpest argument for D40's lexical check: a dense vector always returns " +
      "a nearest neighbour, however absent the topic. THIS IS THE QUERY THAT EXPOSED THE LIVE " +
      "HALLUCINATION (D36): fed these five irrelevant chunks, the real model cited First Term " +
      "week 3 and Third Term week 3 as the curriculum basis for a summary-writing lesson. " +
      "Left failing on purpose — v4 stops the false citation, but the false MATCH is CP6's job.",
  },
];
