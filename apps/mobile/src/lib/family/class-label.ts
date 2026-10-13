// How a child's class reads on the parent's screens.
//
// Most schools name an arm with its level in it ("JSS 2 A"), so "level · arm"
// read "JSS 2 · JSS 2 A" (mobile review, 2026-10-13). The level is shown only
// when the arm's own name does not already carry it ("Gold" → "JSS 2 · Gold").
export function classLabel(levelName: string, armName: string): string {
  const level = levelName.trim();
  const arm = armName.trim();
  if (level === "" || arm.toLowerCase().startsWith(level.toLowerCase())) return arm;
  return `${level} · ${arm}`;
}
