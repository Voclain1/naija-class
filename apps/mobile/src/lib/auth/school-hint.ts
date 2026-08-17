// Normalisation for the remembered school code (slug).
//
// Its own react-native-free module, matching ./principal — apps/mobile's
// Vitest runs node-env with no React Native transform, so anything importing
// AsyncStorage is unreachable from a spec. The storage side lives in
// ./school-hint-store.

/**
 * Normalise a stored or server-supplied school slug into the exact string a
 * child would need to type, or null if there is nothing usable.
 *
 * Trimmed and lowercased to match `studentLoginSchema`, which does the same
 * server-side. If the two disagreed, a prefilled value could be rejected while
 * looking identical on screen — the worst kind of login failure, because the
 * child can see nothing wrong with what is in the box.
 */
export function normaliseSchoolHint(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}
