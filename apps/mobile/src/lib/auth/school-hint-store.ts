import AsyncStorage from "@react-native-async-storage/async-storage";

import { normaliseSchoolHint } from "./school-hint";

// The remembered school code, so a returning child never has to type one.
//
// WHY THIS IS NOT IN token-store.ts, and not in SecureStore:
//
//   1. It is not a credential. A school slug is public — it is in URLs, and
//      `auth_lookup_student_for_login` is documented as treating slugs as
//      public knowledge. Putting a non-secret in the Keychain would blur the
//      line about what that store is for.
//   2. It must SURVIVE sign-out. clearToken() deliberately wipes everything
//      it owns; that is exactly right for a token and exactly wrong here.
//      A child who signs out and comes back is the case this exists to serve.
//
// The problem it solves is real: before this, `schoolSlug` appeared in the
// whole app only as an input on the login screen. It was displayed nowhere,
// so a child could set a password through an invitation and then be unable to
// sign in again unless an adult happened to know the code and tell them.
//
// It is a hint, never an authority. The field stays editable, the server still
// requires the code, and a wrong or stale value fails the same as a typo.

const SCHOOL_HINT_KEY = "sk_school_hint";

/** Remember the school code from a successful student login or activation. */
export async function saveSchoolHint(slug: string): Promise<void> {
  const normalised = normaliseSchoolHint(slug);
  if (normalised === null) return;
  try {
    await AsyncStorage.setItem(SCHOOL_HINT_KEY, normalised);
  } catch {
    // A hint that fails to persist costs one typed field on the next login.
    // It must never break the sign-in that just succeeded.
  }
}

/** The remembered school code, or null if there is none. */
export async function loadSchoolHint(): Promise<string | null> {
  try {
    return normaliseSchoolHint(await AsyncStorage.getItem(SCHOOL_HINT_KEY));
  } catch {
    return null;
  }
}
