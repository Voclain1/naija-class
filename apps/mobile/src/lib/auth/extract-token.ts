// Pull an invitation token out of whatever the user pasted.
//
// Its own react-native-free module for the same reason as ./principal:
// apps/mobile's Vitest runs node-env with no React Native transform, so a rule
// living inside a screen component cannot be reached by a spec.
//
// A parent forwarding a link is far more likely to paste the whole URL than to
// isolate the token from it, and a child re-typing a long random string is a
// transcription error waiting to happen. Both shapes have to work, because the
// person pasting does not know which one they are holding.

/** Does this look like `scheme://…`? */
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

export function extractToken(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "";

  // Strip any query string or fragment first — forwarded links pick these up
  // from messaging apps and link trackers, and neither is part of the token.
  const withoutQuery = trimmed.split(/[?#]/)[0] ?? "";

  const scheme = SCHEME.exec(withoutQuery);
  if (scheme) {
    const afterScheme = withoutQuery.slice(scheme[0].length);
    const firstSlash = afterScheme.indexOf("/");
    // An origin with no path carries no token. Returning the HOST here would
    // be worse than returning nothing: it looks like a code, gets sent to the
    // server, and comes back as "this link is no longer valid" — sending the
    // child to ask for a replacement link when the one they have is fine and
    // they simply pasted too little of it.
    if (firstSlash === -1) return "";
    return lastSegment(afterScheme.slice(firstSlash));
  }

  return lastSegment(withoutQuery);
}

function lastSegment(path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments.length > 0 ? (segments[segments.length - 1] ?? "") : "";
}
