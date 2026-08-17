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

/**
 * Whether the login screen should collapse the school-code input down to
 * "Signing in to <code>" instead of showing the field.
 *
 * Collapsing is only safe when we have a remembered code AND it is still the
 * value that would be submitted. Two states deliberately keep the field:
 *
 *   - `editing` — the user tapped "Not your school?". Re-collapsing under
 *     someone mid-correction would hide the very thing they are fixing.
 *   - a `current` that has diverged from `remembered` — they are typing a
 *     different school, and the summary line would then be a lie about what
 *     is actually going to be sent.
 *
 * Extracted from the component so these combinations are testable: Vitest
 * runs node-env with no React Native transform, so a predicate living inside
 * login.tsx would be unreachable from a spec.
 */
export function shouldCollapseSchoolField(input: {
  isStudent: boolean;
  editing: boolean;
  remembered: string | null;
  current: string;
}): boolean {
  const { isStudent, editing, remembered, current } = input;
  if (!isStudent || editing || remembered === null) return false;
  return current === remembered;
}
