/**
 * A dashboard load is read-only. Never display an exception's text here:
 * it can contain a backend code or request detail that does not help an owner
 * recover. The next useful action is simply to retry the read.
 */
export function dashboardErrorMessage(_error: unknown): string {
  return "We couldn’t load your dashboard. Refresh and try again.";
}
