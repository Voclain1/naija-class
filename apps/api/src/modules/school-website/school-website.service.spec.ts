import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  createAnnouncementSchema,
  uploadWebsitePhotoSchema,
  websiteLimitsFor,
  websiteSectionMinPlan,
  type SchoolPlan,
} from "@school-kit/types";

import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { AnnouncementsService } from "../announcements/announcements.service.js";
import { AuthService } from "../auth/auth.service.js";
import { CalendarService } from "../calendar/calendar.service.js";
import { SchoolPublicService } from "../schools/school-public.service.js";
import { SchoolWebsitePlatformService } from "./school-website-platform.service.js";
import { SchoolWebsitePublicService } from "./school-website-public.service.js";
import { SchoolWebsiteService } from "./school-website.service.js";
import { makePreviewToken, verifyPreviewToken } from "./website-content.js";

// The school's public website (docs/modules/school-website.md). Real
// database, real storage on disk.

const runId = Math.random().toString(36).slice(2, 8);
const auth = new AuthService();
const reqCtx = { ipAddress: "127.0.0.1", userAgent: null as string | null };
const storageRoot = mkdtempSync(join(tmpdir(), "website-"));
const storage = new StorageService(new FilesystemStorageDriver(storageRoot, { baseUrl: "http://localhost:4000/api/v1", secret: "s" }));
const website = new SchoolWebsiteService(storage);
const publicSite = new SchoolWebsitePublicService(storage);
const frontPage = new SchoolPublicService(storage);
const platform = new SchoolWebsitePlatformService(website);
const announcements = new AnnouncementsService();
const calendar = new CalendarService();
const schoolIds = new Set<string>();
let phoneCounter = 0;
const phone = () => `+23482${String(++phoneCounter % 100).padStart(2, "0")}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const files = { large: JPEG, thumb: JPEG };
const ctx = (s: { schoolId: string; ownerId: string }) => ({ sessionId: "sess", userId: s.ownerId, schoolId: s.schoolId });
const platformCtx = (userId: string) => ({ sessionId: "sess", userId });

const savedEnforcement = process.env.PLAN_ENFORCEMENT;
afterEach(() => {
  if (savedEnforcement === undefined) delete process.env.PLAN_ENFORCEMENT;
  else process.env.PLAN_ENFORCEMENT = savedEnforcement;
});

afterAll(async () => {
  for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
  rmSync(storageRoot, { recursive: true, force: true });
});

async function makeSchool(suffix: string, plan: SchoolPlan = "FREE") {
  const slug = `web-${suffix}-${runId}`;
  const signed = await auth.signupOwner(
    {
      schoolName: `Web ${suffix} ${runId}`,
      schoolSlug: slug,
      ownerFirstName: "Ngozi",
      ownerLastName: "Owner",
      ownerEmail: `${slug}@example.test`,
      ownerPhone: phone(),
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    reqCtx,
  );
  schoolIds.add(signed.school.id);
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5, plan } });
  return { schoolId: signed.school.id, ownerId: signed.user.id, slug };
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("plan levels", () => {
  it("gives every school the top tier under warn, and the plan's own under enforce", () => {
    expect(websiteLimitsFor("FREE", "warn").galleryPhotos).toBe(300);
    expect(websiteLimitsFor("FREE", "enforce")).toMatchObject({ details: false, news: 0, galleryPhotos: 0, events: 3, announcements: 3 });
    expect(websiteLimitsFor("STARTER", "enforce")).toMatchObject({ details: true, news: 10, photosPerPost: 2, galleryPhotos: 0 });
    expect(websiteLimitsFor("GROWTH", "enforce")).toMatchObject({ news: null, galleryPhotos: 60, leaders: 6, accent: false });
    expect(websiteSectionMinPlan("news")).toBe("STARTER");
    expect(websiteSectionMinPlan("gallery")).toBe("GROWTH");
    expect(websiteSectionMinPlan("accent")).toBe("PROFESSIONAL");
    expect(websiteSectionMinPlan("events")).toBe("FREE");
  });

  it("refuses a photo without the no-pupils tick, and staff or class announcements on the website", () => {
    expect(uploadWebsitePhotoSchema.safeParse({ kind: "GALLERY" }).success).toBe(false);
    expect(uploadWebsitePhotoSchema.safeParse({ kind: "GALLERY", noPupils: "false" }).success).toBe(false);
    expect(uploadWebsitePhotoSchema.safeParse({ kind: "GALLERY", noPupils: "true" }).success).toBe(true);
    expect(uploadWebsitePhotoSchema.safeParse({ kind: "POST", noPupils: "true" }).success).toBe(false);
    expect(createAnnouncementSchema.safeParse({ title: "t", body: "b", audience: "STAFF", showOnWebsite: true }).success).toBe(false);
    expect(createAnnouncementSchema.safeParse({ title: "t", body: "b", audience: "PARENTS", showOnWebsite: true }).success).toBe(true);
  });

  it("signs preview links for one school only, and only until they expire", () => {
    const now = new Date("2026-10-22T10:00:00Z");
    const { token } = makePreviewToken("school-a", now, "key");
    expect(verifyPreviewToken("school-a", token, now, "key")).toBe(true);
    expect(verifyPreviewToken("school-b", token, now, "key")).toBe(false);
    expect(verifyPreviewToken("school-a", token, new Date(now.getTime() + 31 * 60_000), "key")).toBe(false);
    expect(verifyPreviewToken("school-a", `${Date.now() + 9e9}.forged`, now, "key")).toBe(false);
    expect(verifyPreviewToken("school-a", undefined, now, "key")).toBe(false);
  });
});

describe("events and announcements on the website", () => {
  let A: Awaited<ReturnType<typeof makeSchool>>;
  beforeAll(async () => {
    A = await makeSchool("events");
  });

  it("shows only what the school ticked, upcoming, and never staff, class or withdrawn announcements", async () => {
    await calendar.createSchoolEvent(ctx(A), { title: "Inter-house sports", category: "EVENT", startDate: future(5), endDate: future(5), showOnWebsite: true }, reqCtx);
    await calendar.createSchoolEvent(ctx(A), { title: "Staff retreat", category: "MEETING", startDate: future(6), endDate: future(6) }, reqCtx);
    const shown = await announcements.create(ctx(A), { title: "Open day", body: "Come and see us.", audience: "EVERYONE", showOnWebsite: true }, reqCtx);
    const quiet = await announcements.create(ctx(A), { title: "PTA levy", body: "Due Friday.", audience: "PARENTS" }, reqCtx);
    expect(shown.showOnWebsite).toBe(true);
    // The database refuses a staff announcement on the website, whatever the service does.
    await expect(
      withTenant(A.schoolId, (db) =>
        db.announcement.create({ data: { schoolId: A.schoolId, title: "x", body: "y", audience: "STAFF", showOnWebsite: true, createdBy: A.ownerId } }),
      ),
    ).rejects.toThrow();

    let page = await frontPage.get(A.slug);
    expect(page.website.events.map((e) => e.title)).toEqual(["Inter-house sports"]);
    expect(page.website.announcements.map((a) => a.title)).toEqual(["Open day"]);
    // Nobody's name: an announcement shows its title, date and text only.
    expect(Object.keys(page.website.announcements[0]!).sort()).toEqual(["body", "date", "id", "title"]);

    // Switched on later; then withdrawn, it leaves the page.
    await announcements.setShowOnWebsite(ctx(A), quiet.id, true, reqCtx);
    await announcements.withdraw(ctx(A), shown.id, reqCtx);
    page = await frontPage.get(A.slug);
    expect(page.website.announcements.map((a) => a.title)).toEqual(["PTA levy"]);
    await expect(announcements.setShowOnWebsite(ctx(A), shown.id, true, reqCtx)).rejects.toMatchObject({ code: "ALREADY_WITHDRAWN" });
  });

  it("caps a Free school at 3 of each once enforced, and shows more under warn", async () => {
    for (let i = 0; i < 4; i += 1) {
      await calendar.createSchoolEvent(ctx(A), { title: `Event ${i}`, category: "EVENT", startDate: future(10 + i), endDate: future(10 + i), showOnWebsite: true }, reqCtx);
    }
    process.env.PLAN_ENFORCEMENT = "warn";
    expect((await frontPage.get(A.slug)).website.events).toHaveLength(5);
    process.env.PLAN_ENFORCEMENT = "enforce";
    const page = await frontPage.get(A.slug);
    expect(page.website.events).toHaveLength(3);
    expect(page.website.news).toBeNull();
    expect(page.website.gallery).toBeNull();
  });
});

describe("page details: draft, preview and publish", () => {
  let A: Awaited<ReturnType<typeof makeSchool>>;
  let B: Awaited<ReturnType<typeof makeSchool>>;
  beforeAll(async () => {
    A = await makeSchool("details", "STARTER");
    B = await makeSchool("other", "GROWTH");
  });

  it("keeps the draft from families until it is published; a preview link shows it", async () => {
    const cover = await website.uploadPhoto(ctx(A), files, { kind: "COVER", noPupils: "true" }, reqCtx);
    const saved = await website.saveDraft(ctx(A), { coverPhotoId: cover.id, welcome: "Welcome to our school", story: "Founded by the parish.", founded: 1998, levels: ["NURSERY", "PRIMARY"] }, reqCtx);
    expect(saved.unpublishedChanges).toBe(true);
    expect(saved.published).toBeNull();

    expect((await frontPage.get(A.slug)).website.cover).toBeNull();

    const preview = await website.preview(ctx(A));
    const token = new URL(preview.url).searchParams.get("preview")!;
    const previewed = await frontPage.get(A.slug, token);
    expect(previewed.website.preview).toBe(true);
    expect(previewed.website.cover?.welcome).toBe("Welcome to our school");
    expect(previewed.website.cover?.photo?.thumbUrl).toContain(cover.id);
    // Another school's token shows nothing of the draft.
    const other = await website.preview(ctx(B));
    expect((await frontPage.get(A.slug, new URL(other.url).searchParams.get("preview")!)).website.preview).toBe(false);

    const published = await website.publish(ctx(A), reqCtx);
    expect(published.unpublishedChanges).toBe(false);
    const page = await frontPage.get(A.slug);
    expect(page.website.about?.story).toBe("Founded by the parish.");
    expect(page.website.facts).toEqual([
      { label: "Founded", value: "1998" },
      { label: "Levels", value: "Nursery, Primary" },
    ]);
  });

  it("refuses another school's photo in the draft", async () => {
    const theirs = await website.uploadPhoto(ctx(B), files, { kind: "COVER", noPupils: "true" }, reqCtx);
    await expect(website.saveDraft(ctx(A), { coverPhotoId: theirs.id }, reqCtx)).rejects.toMatchObject({ code: "WEBSITE_PHOTO_MISSING" });
  });

  it("refuses bytes that are not a JPEG", async () => {
    await expect(website.uploadPhoto(ctx(A), { large: PNG, thumb: JPEG }, { kind: "COVER", noPupils: "true" }, reqCtx)).rejects.toMatchObject({ code: "INVALID_FILE_TYPE" });
  });

  it("hides the details, not deletes them, when the plan no longer covers them", async () => {
    process.env.PLAN_ENFORCEMENT = "enforce";
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { plan: "FREE" } });
    expect((await frontPage.get(A.slug)).website.about).toBeNull();
    const view = await website.get(ctx(A));
    expect(view.published?.story).toBe("Founded by the parish.");
    expect(view.sections.find((s) => s.section === "details")).toMatchObject({ open: false, inPlan: false, minPlan: "STARTER" });
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { plan: "STARTER" } });
    expect((await frontPage.get(A.slug)).website.about?.story).toBe("Founded by the parish.");
  });

  it("an admin may edit the website; a teacher may not", async () => {
    const ids = await withTenant(A.schoolId, async (db) => {
      const [adminRole, teacherRole] = await Promise.all([
        db.role.findFirstOrThrow({ where: { key: "admin" }, select: { id: true, permissions: true } }),
        db.role.findFirstOrThrow({ where: { key: "teacher" }, select: { id: true } }),
      ]);
      expect(adminRole.permissions).toContain("website.manage");
      const admin = await db.user.create({ data: { schoolId: A.schoolId, email: `web-admin-${runId}@example.test`, firstName: "Ada", lastName: "Admin" } });
      const teacher = await db.user.create({ data: { schoolId: A.schoolId, email: `web-teacher-${runId}@example.test`, firstName: "Tunde", lastName: "Teacher" } });
      await db.userRole.create({ data: { userId: admin.id, roleId: adminRole.id } });
      await db.userRole.create({ data: { userId: teacher.id, roleId: teacherRole.id } });
      return { admin: admin.id, teacher: teacher.id };
    });
    await expect(website.get({ sessionId: "s", userId: ids.admin, schoolId: A.schoolId })).resolves.toBeTruthy();
    await expect(website.get({ sessionId: "s", userId: ids.teacher, schoolId: A.schoolId })).rejects.toMatchObject({ httpStatus: 403 });
  });
});

describe("news, the gallery, reports and take-downs", () => {
  let A: Awaited<ReturnType<typeof makeSchool>>;
  let operatorId: string;
  beforeAll(async () => {
    A = await makeSchool("news", "GROWTH");
    operatorId = A.ownerId;
  });

  it("publishes posts with photos; the plan caps photos per post", async () => {
    process.env.PLAN_ENFORCEMENT = "enforce";
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { plan: "STARTER" } });
    const post = await website.createPost(ctx(A), { title: "Science fair", body: "Our JSS students built a solar oven." }, reqCtx);
    await website.uploadPhoto(ctx(A), files, { kind: "POST", postId: post.id, noPupils: "true", caption: "The oven" }, reqCtx);
    await website.uploadPhoto(ctx(A), files, { kind: "POST", postId: post.id, noPupils: "true" }, reqCtx);
    await expect(website.uploadPhoto(ctx(A), files, { kind: "POST", postId: post.id, noPupils: "true" }, reqCtx)).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });

    // Not public while a draft.
    expect((await frontPage.get(A.slug)).website.news).toEqual({ latest: [], total: 0 });
    await website.setPostPublished(ctx(A), post.id, true, reqCtx);
    const page = await frontPage.get(A.slug);
    expect(page.website.news?.latest[0]).toMatchObject({ title: "Science fair", excerpt: "Our JSS students built a solar oven." });
    const read = await publicSite.post(A.slug, post.id);
    expect(read.photos).toHaveLength(2);
    expect(Object.keys(read).sort()).toEqual(["body", "id", "photos", "publishedAt", "title"]);
    expect((await publicSite.news(A.slug, 1)).posts).toHaveLength(1);

    // Free has no news: publishing is refused once enforced.
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { plan: "FREE" } });
    const draft = await website.createPost(ctx(A), { title: "Draft", body: "Not yet." }, reqCtx);
    await expect(website.setPostPublished(ctx(A), draft.id, true, reqCtx)).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(publicSite.news(A.slug, 1)).rejects.toMatchObject({ httpStatus: 404 });
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { plan: "GROWTH" } });
  });

  it("shows the gallery in albums, up to the plan's cap", async () => {
    process.env.PLAN_ENFORCEMENT = "enforce";
    const album = await website.createAlbum(ctx(A), { title: "Our new library" }, reqCtx);
    await website.uploadPhoto(ctx(A), files, { kind: "GALLERY", albumId: album.id, noPupils: "true" }, reqCtx);
    await website.uploadPhoto(ctx(A), files, { kind: "GALLERY", noPupils: "true" }, reqCtx);
    const gallery = await publicSite.gallery(A.slug);
    expect(gallery.albums.map((a) => [a.title, a.photos.length])).toEqual([
      ["Our new library", 1],
      ["More photos", 1],
    ]);
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { plan: "STARTER" } });
    await expect(website.uploadPhoto(ctx(A), files, { kind: "GALLERY", noPupils: "true" }, reqCtx)).rejects.toMatchObject({ code: "PLAN_FEATURE_UNAVAILABLE" });
    await expect(publicSite.gallery(A.slug)).rejects.toMatchObject({ httpStatus: 404 });
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { plan: "GROWTH" } });
  });

  it("a report reaches SchoolKit's queue; a take-down hides the photo for good and answers the report", async () => {
    const photo = (await website.listPhotos(ctx(A), "GALLERY")).photos[0]!;
    await publicSite.report(A.slug, { photoId: photo.id, reason: "This shows children." });
    await publicSite.report(A.slug, { photoId: photo.id, reason: "Pupils' faces are visible." });
    const queue = await platform.queue();
    expect(queue.schools.find((s) => s.schoolId === A.schoolId)?.openReports).toBe(2);

    const review = await platform.review(A.schoolId, platformCtx(operatorId), reqCtx);
    expect(review.reports).toHaveLength(2);

    await platform.takeDown(A.schoolId, { photoId: photo.id, reason: "Pupils are visible." }, platformCtx(operatorId), reqCtx);
    expect((await platform.queue()).schools.find((s) => s.schoolId === A.schoolId)).toBeUndefined();
    const gallery = await publicSite.gallery(A.slug);
    expect(gallery.albums.flatMap((a) => a.photos).map((p) => p.id)).not.toContain(photo.id);
    // The school sees why.
    const mine = (await website.listPhotos(ctx(A), "GALLERY")).photos.find((p) => p.id === photo.id);
    expect(mine?.takenDown?.reason).toBe("Pupils are visible.");
    // A report of something already down is refused.
    await expect(publicSite.report(A.slug, { photoId: photo.id, reason: "Again" })).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("a taken-down post cannot be changed or published again; a dismissed report clears the queue", async () => {
    const post = await website.createPost(ctx(A), { title: "Prize day", body: "Well done to all." }, reqCtx);
    await website.setPostPublished(ctx(A), post.id, true, reqCtx);
    await publicSite.report(A.slug, { postId: post.id, reason: "Names a pupil." });
    const reportId = (await platform.review(A.schoolId, platformCtx(operatorId), reqCtx)).reports[0]!.id;
    await platform.dismissReport(A.schoolId, reportId, platformCtx(operatorId), reqCtx);
    expect((await platform.queue()).schools.find((s) => s.schoolId === A.schoolId)).toBeUndefined();

    await platform.takeDown(A.schoolId, { postId: post.id, reason: "Names a pupil." }, platformCtx(operatorId), reqCtx);
    await expect(publicSite.post(A.slug, post.id)).rejects.toMatchObject({ httpStatus: 404 });
    await expect(website.updatePost(ctx(A), post.id, { title: "Prize day!" }, reqCtx)).rejects.toMatchObject({ code: "WEBSITE_TAKEN_DOWN" });
    await expect(website.setPostPublished(ctx(A), post.id, true, reqCtx)).rejects.toMatchObject({ code: "WEBSITE_TAKEN_DOWN" });
  });

  it("deleting a post deletes its photos' files", async () => {
    const post = await website.createPost(ctx(A), { title: "Gone soon", body: "Short-lived." }, reqCtx);
    const photo = await website.uploadPhoto(ctx(A), files, { kind: "POST", postId: post.id, noPupils: "true" }, reqCtx);
    const key = { kind: "website-photo" as const, photoId: photo.id, size: "large" as const };
    await expect(storage.get(A.schoolId, key)).resolves.toBeTruthy();
    await website.deletePost(ctx(A), post.id, reqCtx);
    await expect(storage.get(A.schoolId, key)).rejects.toThrow();
  });

  it("keeps each school's website rows to itself (RLS)", async () => {
    const other = await makeSchool("rls");
    const seen = await withTenant(other.schoolId, (db) => db.schoolWebsitePhoto.count({ where: { schoolId: A.schoolId } }));
    expect(seen).toBe(0);
    await expect(
      withTenant(other.schoolId, (db) =>
        db.schoolWebsitePost.create({ data: { schoolId: A.schoolId, title: "x", body: "y", createdBy: other.ownerId } }),
      ),
    ).rejects.toThrow();
  });
});

describe("search: titles, canonical addresses and the sitemap", () => {
  let A: Awaited<ReturnType<typeof makeSchool>>;
  beforeAll(async () => {
    A = await makeSchool("seo", "GROWTH");
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { address: "14 Ogui Road, Enugu, Enugu State" } });
  });

  it("gives search details on every plan, with the town from the address unless one is typed", async () => {
    let page = await frontPage.get(A.slug);
    expect(page.seo.town).toBe("Enugu");
    expect(page.seo.description).toBeNull();
    // Addresses are not live in tests: every URL is on the portal.
    expect(page.seo.urls.home).toMatch(new RegExp(`/school/${A.slug}$`));
    expect(page.seo.urls.news).toMatch(new RegExp(`/school/${A.slug}/news$`));

    await website.saveDraft(ctx(A), { levels: ["NURSERY", "PRIMARY"], town: "Independence Layout, Enugu", searchDescription: "A caring nursery and primary school in Enugu." }, reqCtx);
    expect((await frontPage.get(A.slug)).seo.town).toBe("Enugu"); // the draft is not public
    await website.publish(ctx(A), reqCtx);
    page = await frontPage.get(A.slug);
    expect(page.seo).toMatchObject({
      town: "Independence Layout, Enugu",
      description: "A caring nursery and primary school in Enugu.",
      levels: ["Nursery", "Primary"],
    });
    expect(page.seo.updatedAt).not.toBeNull();
  });

  it("lists only the pages families can see, at their canonical addresses", async () => {
    const draft = await website.createPost(ctx(A), { title: "Draft", body: "Not yet." }, reqCtx);
    let map = await publicSite.sitemap(A.slug);
    // A draft post is not listed; the front page is, and the admission form (open by default).
    expect(map.entries.map((e) => e.url)).toEqual([
      expect.stringMatching(new RegExp(`/school/${A.slug}$`)),
      expect.stringMatching(new RegExp(`/apply/${A.slug}$`)),
    ]);

    await website.setPostPublished(ctx(A), draft.id, true, reqCtx);
    await website.uploadPhoto(ctx(A), files, { kind: "GALLERY", noPupils: "true" }, reqCtx);
    map = await publicSite.sitemap(A.slug);
    const urls = map.entries.map((e) => e.url);
    expect(urls).toContain(`${(await frontPage.get(A.slug)).seo.urls.news}/${draft.id}`);
    expect(urls.some((u) => u.endsWith("/gallery"))).toBe(true);
    expect(map.entries.find((e) => e.url.endsWith(draft.id))?.lastModified).not.toBeNull();
  });
});
