// The password rules staff and parents choose under (Phase 3 onwards): at
// least 8 characters, with an upper-case letter, a lower-case letter, a digit
// and a symbol. The signup, invitation and reset schemas each carry the same
// rules as zod regexes; this is the same test as a plain function, for the
// one place that checks a password someone already has: sign-in, which asks
// accounts created under the older Phase 0 rules to choose a new one.

export function meetsPasswordPolicy(password: string): boolean {
  return (
    password.length >= 8 &&
    password.length <= 128 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}
