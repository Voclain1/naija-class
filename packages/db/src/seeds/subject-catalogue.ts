// The standard subject list by stage (2026-11-02, docs/modules/subjects-by-class.md).
//
// Every school gets these subjects, each tagged with the stages it is taught
// in. A class's subjects are the school's active subjects tagged with the
// class's stage, so a school that deletes classes, adds new ones or moves a
// class to another stage needs no remapping. Schools add their own subjects
// and untag stages they do not offer; nothing here is ever re-imposed.
//
// Nothing shows on a report card unless a teacher recorded scores for it,
// so a long list (about 35 SSS subjects) costs a school nothing.
//
// `aliases` are other names schools use for the same subject, compared after
// lower-casing and dropping everything that is not a letter or digit. The
// one-off backfill for existing schools (migration 20261202130000) matches on
// them so "Maths" is not added a second time beside "Mathematics".

export type CatalogueStage = "NURSERY" | "KG" | "PRIMARY" | "JSS" | "SSS";

export interface CatalogueSubject {
  code: string;
  name: string;
  category: "CORE" | "ELECTIVE" | "VOCATIONAL";
  stages: readonly CatalogueStage[];
  aliases?: readonly string[];
}

const N = "NURSERY" as const;
const K = "KG" as const;
const P = "PRIMARY" as const;
const J = "JSS" as const;
const S = "SSS" as const;

export const SUBJECT_CATALOGUE: readonly CatalogueSubject[] = [
  // ---- Nursery -------------------------------------------------------------
  { code: "number-work", name: "Number Work", category: "CORE", stages: [N], aliases: ["number work", "numbers"] },
  { code: "letter-work", name: "Letter Work", category: "CORE", stages: [N], aliases: ["letter work", "letters"] },
  { code: "rhymes-songs", name: "Rhymes and Songs", category: "CORE", stages: [N], aliases: ["rhymes", "songs", "rhymes & songs"] },
  { code: "colouring-drawing", name: "Colouring and Drawing", category: "CORE", stages: [N], aliases: ["colouring", "drawing", "coloring"] },
  { code: "nature-study", name: "Nature Study", category: "CORE", stages: [N] },
  { code: "physical-play", name: "Physical Play", category: "CORE", stages: [N] },

  // ---- Nursery and KG ------------------------------------------------------
  { code: "social-habits", name: "Social Habits", category: "CORE", stages: [N, K] },
  { code: "health-habits", name: "Health Habits", category: "CORE", stages: [N, K] },

  // ---- KG ------------------------------------------------------------------
  { code: "literacy", name: "Literacy", category: "CORE", stages: [K], aliases: ["literacy english", "english literacy"] },
  { code: "numeracy", name: "Numeracy", category: "CORE", stages: [K] },
  { code: "phonics", name: "Phonics", category: "CORE", stages: [K] },
  { code: "handwriting", name: "Handwriting", category: "CORE", stages: [K, P], aliases: ["writing", "hand writing"] },
  { code: "rhymes-poems", name: "Rhymes and Poems", category: "CORE", stages: [K], aliases: ["poems", "rhymes & poems"] },
  { code: "creative-arts", name: "Creative Arts", category: "CORE", stages: [K], aliases: ["art", "arts"] },

  // ---- Shared from KG or Primary upwards ----------------------------------
  { code: "english", name: "English Language", category: "CORE", stages: [P, J, S], aliases: ["english", "english studies", "eng"] },
  { code: "math", name: "Mathematics", category: "CORE", stages: [P, J, S], aliases: ["maths", "math", "general mathematics"] },
  { code: "basic-science", name: "Basic Science", category: "CORE", stages: [K, J] },
  { code: "basic-science-technology", name: "Basic Science and Technology", category: "CORE", stages: [P], aliases: ["bst"] },
  { code: "social-studies", name: "Social Studies", category: "CORE", stages: [K, P, J] },
  { code: "civic-education", name: "Civic Education", category: "CORE", stages: [P, J, S], aliases: ["civic", "civics"] },
  { code: "security-education", name: "Security Education", category: "CORE", stages: [P, J] },
  { code: "physical-health-education", name: "Physical and Health Education", category: "CORE", stages: [K, P, J], aliases: ["phe", "physical & health education"] },
  { code: "crs", name: "Christian Religious Studies", category: "ELECTIVE", stages: [N, K, P, J, S], aliases: ["crs", "crk", "christian religious knowledge", "bible knowledge"] },
  { code: "irs", name: "Islamic Religious Studies", category: "ELECTIVE", stages: [N, K, P, J, S], aliases: ["irs", "irk", "islamic religious knowledge", "islamic studies"] },
  { code: "cultural-creative-arts", name: "Cultural and Creative Arts", category: "CORE", stages: [P, J], aliases: ["cca", "cultural and creative art"] },
  { code: "computer-studies", name: "Computer Studies", category: "CORE", stages: [P, J], aliases: ["computer", "ict", "information technology", "digital technologies"] },
  { code: "agricultural-science", name: "Agricultural Science", category: "ELECTIVE", stages: [P, J, S], aliases: ["agric", "agriculture", "agric science"] },
  { code: "home-economics", name: "Home Economics", category: "ELECTIVE", stages: [P, J], aliases: ["home econs"] },
  { code: "history", name: "History", category: "ELECTIVE", stages: [P, J, S] },
  { code: "french", name: "French", category: "ELECTIVE", stages: [P, J, S], aliases: ["french language"] },
  { code: "yoruba", name: "Yoruba", category: "ELECTIVE", stages: [P, J, S], aliases: ["yoruba language"] },
  { code: "igbo", name: "Igbo", category: "ELECTIVE", stages: [P, J, S], aliases: ["igbo language"] },
  { code: "hausa", name: "Hausa", category: "ELECTIVE", stages: [P, J, S], aliases: ["hausa language"] },
  { code: "arabic", name: "Arabic", category: "ELECTIVE", stages: [P, J, S], aliases: ["arabic language"] },

  // ---- Primary only --------------------------------------------------------
  { code: "verbal-reasoning", name: "Verbal Reasoning", category: "ELECTIVE", stages: [P], aliases: ["verbal aptitude"] },
  { code: "quantitative-reasoning", name: "Quantitative Reasoning", category: "ELECTIVE", stages: [P], aliases: ["quantitative aptitude"] },

  // ---- JSS only ------------------------------------------------------------
  { code: "basic-technology", name: "Basic Technology", category: "CORE", stages: [J], aliases: ["intro tech", "introductory technology"] },
  { code: "business-studies", name: "Business Studies", category: "ELECTIVE", stages: [J] },

  // ---- SSS -----------------------------------------------------------------
  { code: "biology", name: "Biology", category: "ELECTIVE", stages: [S] },
  { code: "chemistry", name: "Chemistry", category: "ELECTIVE", stages: [S] },
  { code: "physics", name: "Physics", category: "ELECTIVE", stages: [S] },
  { code: "further-mathematics", name: "Further Mathematics", category: "ELECTIVE", stages: [S], aliases: ["further maths", "f maths"] },
  { code: "geography", name: "Geography", category: "ELECTIVE", stages: [S] },
  { code: "technical-drawing", name: "Technical Drawing", category: "ELECTIVE", stages: [S], aliases: ["td"] },
  { code: "data-processing", name: "Data Processing", category: "ELECTIVE", stages: [S] },
  { code: "economics", name: "Economics", category: "ELECTIVE", stages: [S] },
  { code: "government", name: "Government", category: "ELECTIVE", stages: [S] },
  { code: "literature-in-english", name: "Literature in English", category: "ELECTIVE", stages: [S], aliases: ["literature", "lit in english"] },
  { code: "commerce", name: "Commerce", category: "ELECTIVE", stages: [S] },
  { code: "financial-accounting", name: "Financial Accounting", category: "ELECTIVE", stages: [S], aliases: ["accounting", "accounts", "book keeping"] },
  { code: "marketing", name: "Marketing", category: "VOCATIONAL", stages: [S] },
  { code: "office-practice", name: "Office Practice", category: "VOCATIONAL", stages: [S] },
  { code: "insurance", name: "Insurance", category: "VOCATIONAL", stages: [S] },
  { code: "visual-arts", name: "Visual Arts", category: "ELECTIVE", stages: [S], aliases: ["fine art", "fine arts"] },
  { code: "music", name: "Music", category: "ELECTIVE", stages: [S] },
  { code: "food-nutrition", name: "Food and Nutrition", category: "ELECTIVE", stages: [S] },
  { code: "physical-education", name: "Physical Education", category: "ELECTIVE", stages: [S] },
  { code: "health-education", name: "Health Education", category: "ELECTIVE", stages: [S] },
  { code: "animal-husbandry", name: "Animal Husbandry", category: "VOCATIONAL", stages: [S] },
  { code: "catering-craft", name: "Catering Craft Practice", category: "VOCATIONAL", stages: [S], aliases: ["catering"] },
  { code: "garment-making", name: "Garment Making", category: "VOCATIONAL", stages: [S] },
  { code: "computer-science", name: "Computer Science", category: "ELECTIVE", stages: [S] },
] as const;

/** Lower-case, letters and digits only: how a school's own subject name is matched. */
export function subjectMatchKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Every key that matches a catalogue entry: its name, its code, its aliases. */
export function catalogueKeys(entry: CatalogueSubject): string[] {
  return [...new Set([entry.name, entry.code, ...(entry.aliases ?? [])].map(subjectMatchKey))];
}
