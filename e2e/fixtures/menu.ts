import type { Page } from "@playwright/test";

// The admin and teacher menus fold into families that open and close
// (apps/web/src/components/admin/nav-groups.ts), so a page's link may sit in a
// closed section. This opens a page from the desktop menu the way a person
// does when they cannot see it: by typing its name into "Find a page".
export async function openFromMenu(page: Page, label: string): Promise<void> {
  const menu = page.locator("aside").getByRole("navigation", { name: "Main menu" });
  const link = menu.getByRole("link", { name: label, exact: true });
  // The menu draws after the person's permissions load.
  await menu.getByRole("link").first().waitFor({ timeout: 60_000 });
  if (!(await link.isVisible())) {
    await menu.getByLabel("Find a page").fill(label);
  }
  await link.click();
}
