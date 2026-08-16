// School Kit mobile — "as of <time>" formatting. Implements phase-6.md D11.
//
// Every cached screen must state how old its data is. This is not a UX
// nicety: the app renders from cache first and revalidates in the background,
// so on a bad connection a parent can be looking at last week's numbers with
// no visual difference from live ones. On the fee screen that is a
// money-correctness problem — an outstanding balance shown as settled, or a
// paid balance shown as owing — even though no write happened.
//
// Pure functions, no React and no React Native imports, so they are unit
// tested directly under Vitest's node environment.

/** Data older than this is called out prominently rather than in passing. */
export const STALE_AFTER_MS = 1000 * 60 * 60 * 6; // 6 hours

const MINUTE = 1000 * 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;

/**
 * Human "as of" phrasing.
 *
 * Deliberately plain English with no library: `Intl.RelativeTimeFormat`
 * output ("2 hr. ago") reads oddly in this context, and a date library is a
 * bundle cost for six branches.
 *
 * Returns the phrase only — callers prepend "Updated" / "As of" so the label
 * can be reused in different sentence positions.
 */
export function formatAsOf(updatedAt: number, now: number = Date.now()): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return "never";

  const elapsed = now - updatedAt;

  // Clock skew, or a device whose time moved backwards. Claiming data is from
  // the future is worse than rounding to the present.
  if (elapsed < 0) return "just now";

  if (elapsed < MINUTE) return "just now";

  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }

  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  return new Date(updatedAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function isStale(updatedAt: number, now: number = Date.now()): boolean {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return true;
  return now - updatedAt > STALE_AFTER_MS;
}

export interface FreshnessDescriptor {
  /** e.g. "Updated 5 minutes ago", "Showing data from yesterday". */
  label: string;
  /** True when the data is old enough to warrant a visible warning colour. */
  stale: boolean;
}

/**
 * The single place that decides what a screen says about its own freshness.
 *
 * Offline wording differs from online wording on purpose. Online, an old
 * timestamp is informational — a refresh is in flight. Offline, it is the
 * whole story, so the phrasing leads with the fact that this is not live.
 */
export function describeFreshness(
  updatedAt: number,
  options: { online: boolean; now?: number },
): FreshnessDescriptor {
  const now = options.now ?? Date.now();
  const stale = isStale(updatedAt, now);
  const phrase = formatAsOf(updatedAt, now);

  if (!updatedAt) {
    return {
      label: options.online ? "Loading…" : "No offline copy available",
      stale: true,
    };
  }

  if (!options.online) {
    return { label: `Offline — showing data from ${phrase}`, stale: true };
  }

  return { label: `Updated ${phrase}`, stale };
}
