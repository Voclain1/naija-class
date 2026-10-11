// A navigation started from code (router.push) rather than a link click.
//
// The dashboard term selector skips its automatic ?termId= write once the
// person has started to leave the page, because a router.replace() issued
// while a navigation is in flight cancels it (docs/deferred.md, "/dashboard
// navigation race"). Link clicks it can see for itself; a router.push() it
// cannot, so code that navigates from inside the admin shell announces it
// here first. Today that is the command palette.
export const NAVIGATION_INTENT_EVENT = "sk:navigation-intent";

export function announceNavigation(href: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(NAVIGATION_INTENT_EVENT, { detail: href }));
}

/** The path a navigation intent is heading to, resolved against the current page. */
export function intentPathname(event: Event): string | null {
  const href = (event as CustomEvent<unknown>).detail;
  if (typeof href !== "string") return null;
  return new URL(href, window.location.href).pathname;
}
