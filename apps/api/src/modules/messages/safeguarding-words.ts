// Phase 9 / CP8.2 — safeguarding words (docs/modules/phase-9.md §17.8,
// answer 4: "Yes and no AI in messaging"). A fixed list, in English and
// Pidgin, matched on whole words in every message, the family's and the
// school's. A match NEVER blocks or changes a message: it marks the message,
// flags the conversation for the owner and admins, and alerts them without
// the text. Kept narrow on purpose (harm to a child, not everyday
// complaints), so a flag means something. Changing the list is a code change,
// reviewed like one.

const PHRASES = [
  // Abuse and touching
  "abuse", "abused", "abusing", "abusive",
  "molest", "molested", "molesting",
  "rape", "raped", "raping",
  "sexual", "sexually", "harass", "harassed", "harassing", "harassment",
  "groom", "grooming", "groomed",
  "touched me", "touched her", "touched him", "touching me", "touching her", "touching him",
  "touched my child", "touched my daughter", "touched my son", "private parts",
  // Violence and threats
  "beat me", "beat her", "beat him", "beat my child", "beat my daughter", "beat my son", "beaten",
  "flogged", "flogging", "slapped", "kicked", "wounded", "bleeding",
  "threaten", "threatened", "threatening", "kidnap", "kidnapped",
  "starved", "starving", "locked up", "locked in",
  // Self-harm
  "suicide", "suicidal", "kill myself", "kill herself", "kill himself", "self harm", "self-harm",
  "hurt myself", "hurting herself", "hurting himself", "wants to die",
  // Bullying
  "bully", "bullied", "bullying",
  // Pidgin
  "dey beat", "dem beat", "beat am", "flog am", "touch am", "dey touch", "wan kill", "kill am",
  "do am by force", "dey harass", "dem dey touch",
];

const PATTERN = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(?:${PHRASES.map((p) => p.replace(/ /g, "\\s+").replace(/-/g, "[-\\s]?")).join("|")})(?=$|[^\\p{L}\\p{N}])`,
  "iu",
);

/** Whether a message's text contains a safeguarding word. */
export function hasSafeguardingWord(text: string): boolean {
  return text.length > 0 && PATTERN.test(text);
}
