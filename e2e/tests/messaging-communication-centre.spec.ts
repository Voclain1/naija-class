import { expect, test } from "@playwright/test";
import { loginAsAdmin } from "../fixtures/session.js";

test("owner communication centre is responsive and paid services remain safely unavailable", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const owner = await loginAsAdmin(browser);
  const page = owner.page;
  const attemptedWrites: string[] = [];
  // The real API serves readiness and empty histories. Block any paid write
  // from the browser even if someone runs this spec in a misconfigured local
  // environment. No provider requests are needed for this acceptance test.
  await page.route("**/messaging/**", async (route) => {
    if (route.request().method() === "GET" || route.request().method() === "OPTIONS") {
      await route.continue();
    } else {
      attemptedWrites.push(route.request().method());
      await route.abort();
    }
  });
  try {
    const result = await owner.api.get("messaging/overview");
    expect(result.ok(), await result.text()).toBe(true);
    const overview = await result.json();
    expect(overview.topUps?.available).toBe(false);
    expect(overview.whatsapp.status).toBe("DISCONNECTED");

    for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      await page.goto("/settings/communication");
      await expect(page.getByRole("heading",{name:"Communication centre",exact:true})).toBeVisible();
      await expect(page.getByRole("heading",{name:"Automatic paid notifications",exact:true})).toBeVisible();
      await expect(page.getByRole("button",{name:"Save preferences",exact:true})).toBeDisabled();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await testInfo.attach("communication-overview-"+viewport.width,{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
      await page.getByRole("button",{name:"SMS wallet",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Fund your SMS wallet",exact:true})).toBeVisible();
      await expect(page.getByText("New top-ups are unavailable.",{exact:false})).toBeVisible();
      await expect(page.getByRole("button",{name:"Create Paystack checkout",exact:true})).toHaveCount(0);
      await expect(page.getByText("No messaging transactions yet.",{exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      await testInfo.attach("communication-wallet-"+viewport.width,{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
      await page.getByRole("button",{name:"Delivery history",exact:true}).click();
      await expect(page.getByText("No paid message deliveries yet.",{exact:true})).toBeVisible();
      await page.getByRole("button",{name:"WhatsApp",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Connect a school-owned account",exact:true})).toBeVisible();
      await expect(page.getByRole("button",{name:"Continue with Meta",exact:true})).toHaveCount(0);
      await testInfo.attach("communication-whatsapp-"+viewport.width,{body:await page.screenshot({fullPage:true}),contentType:"image/png"});
    }
    expect(attemptedWrites).toEqual([]);
  } finally {
    await owner.context.close();
    await owner.api.dispose();
  }
});
