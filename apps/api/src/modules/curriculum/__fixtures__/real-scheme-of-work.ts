// The REAL extracted text layer of the first scheme of work put through this
// pipeline: a Lagos State unified scheme distributed as a syllabus.ng ebook
// ("English JSS3 Scheme of Work"), uploaded by Virgo Fidelis on 2026-09-02.
//
// Transcribed from the actual document rather than reconstructed. That
// distinction is the whole reason this file exists: two earlier fixtures were
// written from a GUESS about the document's shape, both guesses were wrong in
// different ways, and each wrong guess cost a deploy cycle before the error
// showed up. A fixture taken from the real corpus cannot drift from it.
//
// What it captures, and what each part is here to exercise:
//   * a contents page, whose entries must not become headings;
//   * cover/metadata rows ("Class J.S.S 3", "Subject English Studies");
//   * the table-row term label ("Term  Second Term"), which precedes its table
//     while the decorative banner follows it;
//   * week rows whose topic cell WRAPS ("1 REVISION OF LAST" /
//     "TERM'S EXAMINATION") and whose breakdown is sentence case;
//   * sub-rows with no week number ("GRAMMAR ...", "LITERATURE IN" /
//     "ENGLISH"), the source of the "ENGLISH x8" symptom;
//   * a mid-word column break ("COMPREHENSION/VOC" / "ABULARY");
//   * week RANGES ("5-10 REVISION", "11. -" / "12" / "EXAMINATION");
//   * trailing marketing and textbook pages that must not be mistaken for
//     scheme content ("3 Chapter Three").

const PAGE_2 = `About Us..................................................................................Page 3
Chapter One
About JSS3 Scheme of Work....................................................Page 5
Chapter Two
Syllabus...................................................................................Page 6
Chapter Three
Recommended Textbooks.......................................................Page 11
TABLE OF CONTENT`;

const PAGE_6 = `First Term
2 Chapter Two
Scheme Of Work
LAGOS STATE MINISTRY OF EDUCATION: UNIFIED SCHEMES OF WORK
FOR JUNIOR SECONDARY SCHOOL
English Studies Scheme of Work for Junior Secondary School 3(JSS3)
Class J.S.S 3
Subject English Studies
Term First Term
Week Topic Breakdown
1 REVISION OF LAST
TERM'S EXAMINATION
GRAMMAR Parts of speech – Revision
READING AND
COMPREHENSION
Scanning for main points
COMPOSITION Informal letter – Letter to my best friend on
my plan for the academic session
LITERATURE IN
ENGLISH
I. Introduction to Fiction and Non Fiction
II. Examples of Non Fiction
2 SPEECH WORK The Schwa / ə / sound – about, doctor, above,
etc.
GRAMMAR Expressing/Describing Emotions (Verb +
Preposition)
READING AND
COMPREHENSION
Skimming for Specific Information
COMPOSITION Writing to a pen – pal
LITERATURE IN
ENGLISH
I. Poetry Analysis
II. Use the recommended text on prose.
3 SPEECH WORK Stress and Intonation continued.
 GRAMMAR Adverbs of Frequency – (often, always,
occasionally).
 READING AND
COMPREHENSION
Reading to cultivate the skill of referencing.
COMPOSITION Write a story on the topic – All that glitters is
not gold
LITERATURE IN
ENGLISH
I. Use the recommended text on prose
II. Characterization, Theme, Plot in the prose
text
4 SPEECH WORK Consonants / 3/ and / d3 / - leisure/ledger and
garage/large.`;

const PAGE_7 = `GRAMMAR Changing positive statements to negative
statements using 'not'.
READING AND
COMPREHENSION
Practice scanning, skimming and normal rate
reading.
COMPOSITION How to care for a motor vehicle.
LITERATURE IN
ENGLISH
I. Comprehensive study of the prose text.
II. Introduction the rhyme scheme.
5 SPEECH WORK Contrast consonants / d /, / ð /, / θ / and / z /
— advert, father, loathe and zip.
GRAMMAR Modal Forms – will, can, could, may, that's
Direct and Indirect Forms of Modals
READING AND
COMPREHENSION
I. Reading to differentiate between facts and
opinions.
II. Vocabulary Development – Tourism
COMPOSITION Distinguish between the Features of Formal
and Informal Letters.
LITERATURE IN
ENGLISH
I. Use the recommended drama text
II. Study the different types of rhyme scheme.
6 SPEECH WORK Contrast between / 3: / and / ɔ: /
GRAMMAR Adjectives and Adverbs Expressing
Willingness/Unwillingness using Modal Verbs +
Adverbials
READING AND
COMPREHENSION
Reading to make deductions from a selected
passage.
LITERATURE IN
ENGLISH
I. Use the recommended drama text.
II. Characterization, Diction, setting and plot in
the recommended drama text.
7 SPEECH WORK Consonants / s /, / ʃ / and / tʃ / — ceiling, short,
machine and cheque.
GRAMMAR Adverbs of place and manner
READING AND
COMPREHENSION
Refer to week 5
COMPOSITION Debate – Corruption is worse than armed
robbery
LITERATURE IN
ENGLISH
I. More on Rhyme Schemes.
II. Identification of Costumes and Props in the
Drama text
8 SPEECH WORK Consonants / ʃ / and / tʃ / — sheep/chip and
fish/pitch.
GRAMMAR Idiomatic Expressions.`;

const PAGE_8 = `READING AND
COMPREHENSION
Refer to week 6
COMPOSITION Descriptive Essay – My Favorite Subject
LITERATURE IN
ENGLISH
I. Questions on the prose text
II. Questions on the drama text.
9 SPEECH WORK Consonants / w / and / j /
GRAMMAR Adverbs of Cause or Reason – so that, in order,
so as.
READING AND
COMPREHENSION
Identification of the topic sentence a given
passage.
COMPOSITION Debate – child trafficking is worse than
stealing.
LITERATURE IN
ENGLISH
I. Review of the prose text.
II. Review of the drama text.
10 REVISION
11. –
12
EXAMINATION`;

const PAGE_9 = `Term Second Term
Week Topic Breakdown
1 REVISION OF LAST
TERM'S EXAMINATION
QUESTIONS
SPEECH WORK Consonants / t / and / 0 / — tin/thin and
tick/thick.
READING AND
COMPREHENSION
Reading for Critical Evaluation.
COMPOSITION More on writing to a Pen – Pal
LITERATURE IN
ENGLISH
I. Review the features of folktales
II. Discuss some folktales.
2 SPEECH WORK Consonants contrast / t / and / s / —
tailor/summer, pit/mouse, pat/ pass.
GRAMMAR Prepositions which express relations with
people (with, for, against)
LISTENING
COMPREHENSION
Listening for implied meanings
Second Term`;

const PAGE_12 = `Term Third Term
Week Topic Breakdown
1 REVISION OF 2nd
TERM'S EXAMINATION
2 SPEECH WORK Review of Monotones
COMPREHENSION/VOC
ABULARY
DEVELOPMENT
Look at Some Past Questions
ENGLISH STRUCTURE Review of Nouns and Pronouns
COMPOSITION Review of Narrative/Descriptive Essays
LITERATURE IN
ENGLISH
Review of Major/Minor Characters Theme, Plot,
Tragic/Comic Elements and Diction.
3 COMPREHENSION
/VOCABULARY
DEVELOPMENT
Use past questions
ENGLISH STRUCTURE Review of Verbs and Adverbs
COMPOSITION Review of Argumentative / Expository Essay
SPEECH WORK Review of Diphthongs
LITERATURE IN
ENGLISH
I. Review of Literacy Terms for Poetry
II. Metaphor, Simile, Alliteration, Irony and so
on
4 COMPREHENSION/VOC
ABULARY
DEVELOPMENT
ENGLISH STRUCTURE Review of Adjectives, Conjunctions,
Prepositions and Interjections
COMPOSITION Revisit informal letter, Formal letter and their
features
SPEECH WORK Review of Consonant Sounds
LITERATURE IN
ENGLISH
Use past questions
5-10 REVISION Use Past Questions for all Aspects of the
Revision.
11 EXAMINATION
Third Term`;

const PAGE_14 = `3 Chapter Three
 New Oxford Secondary English Course for Junior Secondary Schools
(Upper Basic Education) 3
 Authors - Ayo Banjo Adekunle Adeniran Ayo Akano Uzoma Onaga Revised Edition.
The recommended textbooks for English in J.S.S.3 include
Recommended Textbooks`;

export const REAL_TEXT = [PAGE_2, PAGE_6, PAGE_7, PAGE_8, PAGE_9, PAGE_12, PAGE_14].join("\n\n");
