import { describe, expect, it } from "vitest";

import type { WebsitePhotoDto } from "@school-kit/types";

import { fitWithin, galleryCap, galleryCountLine, groupByAlbum, photosPerPost, postFormReady, postStatusLabel, sectionPlanNote } from "./website";

const photo = (id: string, albumId: string | null): WebsitePhotoDto => ({
  id,
  kind: "GALLERY",
  postId: null,
  albumId,
  caption: null,
  position: 0,
  thumbUrl: "t",
  largeUrl: "l",
  createdAt: "2026-10-24T10:00:00Z",
  takenDown: null,
});

describe("website news and photos in the staff app", () => {
  it("fits a photo inside the long side and never enlarges it", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 480)).toEqual({ width: 360, height: 480 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("says where a post stands; a take-down wins over published", () => {
    expect(postStatusLabel({ status: "DRAFT", takenDown: null })).toBe("Draft");
    expect(postStatusLabel({ status: "PUBLISHED", takenDown: null })).toBe("Published");
    expect(postStatusLabel({ status: "PUBLISHED", takenDown: { at: "x", reason: "y" } })).toBe("Taken down");
  });

  it("explains plan locks in the web's words, and says nothing when the plan covers it", () => {
    expect(sectionPlanNote({ section: "news", open: true, inPlan: true, minPlan: "GROWTH" }, "enforce")).toBeNull();
    expect(sectionPlanNote({ section: "news", open: true, inPlan: false, minPlan: "GROWTH" }, "warn")).toEqual({
      tone: "info",
      text: "Growth plan — included free during early access.",
    });
    expect(sectionPlanNote({ section: "news", open: false, inPlan: false, minPlan: "GROWTH" }, "enforce")?.tone).toBe("warning");
  });

  it("reads the plan's photo limits, with the hard ceilings behind them", () => {
    const limits = { photosPerPost: 2, galleryPhotos: 60 } as never;
    expect(photosPerPost({ limits })).toBe(2);
    expect(galleryCap({ limits })).toBe(60);
    expect(photosPerPost({ limits: { photosPerPost: 0, galleryPhotos: 0 } as never })).toBe(4);
    expect(galleryCountLine([photo("a", null)], 60)).toBe("1 of 60 photos");
  });

  it("groups photos by album, loose photos last", () => {
    const groups = groupByAlbum([photo("a", "al1"), photo("b", null), photo("c", "gone")], [{ id: "al1", title: "Sports day" }]);
    expect(groups.map((g) => [g.title, g.photos.map((p) => p.id)])).toEqual([
      ["Sports day", ["a"]],
      ["Not in an album", ["b", "c"]],
    ]);
    expect(groupByAlbum([photo("a", null)], []).map((g) => g.title)).toEqual(["All photos"]);
  });

  it("only saves a post with a title and a body inside the limits", () => {
    expect(postFormReady("Our new lab", "Opened today.")).toBe(true);
    expect(postFormReady("  ", "Body")).toBe(false);
    expect(postFormReady("Title", "x".repeat(3001))).toBe(false);
  });
});
