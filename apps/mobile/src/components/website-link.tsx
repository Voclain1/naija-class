import { Button, Caption } from "./ui";
import { openOnWebsite, websiteAvailable } from "./report-access";

// Phase 9 / CP11.2 (docs/modules/phase-9.md §20) — where a piece of work stays
// on the website, the screen says so and opens the right page, signed in
// (the web handoff). Hidden when this build of the app has no website set.
export function WebsiteLink({ path, title, hint }: { path: string; title: string; hint?: string }) {
  if (!websiteAvailable()) return hint ? <Caption>{hint}</Caption> : null;
  return (
    <>
      {hint ? <Caption>{hint}</Caption> : null}
      <Button variant="secondary" title={title} onPress={() => openOnWebsite(path)} />
    </>
  );
}
