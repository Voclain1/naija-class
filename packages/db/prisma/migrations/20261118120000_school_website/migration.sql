-- The school's public website (2026-10-22, docs/modules/school-website.md).
--
-- Builds on school addresses (20261117120000): every school's front page at
-- "<code>.schoolkit.ng" gains the school's own sections, by plan.
--
--   * school_websites: the page details, as a draft and as published.
--   * school_website_posts / _albums / _photos: news and pictures.
--   * school_website_reports: "Report this photo" from the public page.
--   * school_events.show_on_website, announcements.show_on_website: the
--     school ticks what goes on the page, so nothing is typed twice.
--   * schools.website_open_reports: a count for SchoolKit's queue (schools
--     has no RLS), so the operator never reads across schools' reports.
--
-- W4: no pupils on public pages. Every photo carries the uploader's tick
-- (no_pupils_confirmed_by, NOT NULL); there is no other kind of photo.
--
-- The public page resolves the school from its code (schools has no RLS) and
-- reads under that school's GUC, so no SECURITY DEFINER function is needed;
-- the count stays 23. app_user grants come from ALTER DEFAULT PRIVILEGES.

ALTER TABLE "schools" ADD COLUMN "website_open_reports" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "schools" ADD CONSTRAINT "schools_website_open_reports_check" CHECK ("website_open_reports" >= 0);

ALTER TABLE "school_events" ADD COLUMN "show_on_website" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "announcements" ADD COLUMN "show_on_website" BOOLEAN NOT NULL DEFAULT false;
-- Staff-only and single-class announcements are never public.
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_website_audience_check"
  CHECK (NOT "show_on_website" OR "audience" IN ('EVERYONE', 'PARENTS'));

CREATE TYPE "website_post_status" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "website_photo_kind" AS ENUM ('COVER', 'POST', 'GALLERY', 'LEADER');

CREATE TABLE "school_websites" (
  "id"           TEXT         NOT NULL,
  "school_id"    TEXT         NOT NULL,
  "draft"        JSONB        NOT NULL DEFAULT '{}',
  "published"    JSONB,
  "published_at" TIMESTAMP(3),
  "published_by" TEXT,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  "updated_by"   TEXT,

  CONSTRAINT "school_websites_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "school_websites_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "school_websites_school_id_key" ON "school_websites"("school_id");

CREATE TABLE "school_website_posts" (
  "id"               TEXT                  NOT NULL,
  "school_id"        TEXT                  NOT NULL,
  "title"            TEXT                  NOT NULL,
  "body"             TEXT                  NOT NULL,
  "status"           "website_post_status" NOT NULL DEFAULT 'DRAFT',
  "published_at"     TIMESTAMP(3),
  "created_by"       TEXT                  NOT NULL,
  "created_at"       TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)          NOT NULL,
  "taken_down_at"    TIMESTAMP(3),
  "taken_down_by"    TEXT,
  "take_down_reason" TEXT,

  CONSTRAINT "school_website_posts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "school_website_posts_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE,
  CONSTRAINT "school_website_posts_published_check" CHECK ("status" = 'DRAFT' OR "published_at" IS NOT NULL)
);
CREATE INDEX "school_website_posts_school_id_status_published_at_idx" ON "school_website_posts"("school_id", "status", "published_at");

CREATE TABLE "school_website_albums" (
  "id"         TEXT         NOT NULL,
  "school_id"  TEXT         NOT NULL,
  "title"      TEXT         NOT NULL,
  "position"   INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "school_website_albums_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "school_website_albums_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE
);
CREATE INDEX "school_website_albums_school_id_idx" ON "school_website_albums"("school_id");

CREATE TABLE "school_website_photos" (
  "id"                     TEXT                 NOT NULL,
  "school_id"              TEXT                 NOT NULL,
  "kind"                   "website_photo_kind" NOT NULL,
  "post_id"                TEXT,
  "album_id"               TEXT,
  "caption"                TEXT,
  "position"               INTEGER              NOT NULL DEFAULT 0,
  "no_pupils_confirmed_by" TEXT                 NOT NULL,
  "created_at"             TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "taken_down_at"          TIMESTAMP(3),
  "taken_down_by"          TEXT,
  "take_down_reason"       TEXT,

  CONSTRAINT "school_website_photos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "school_website_photos_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE,
  CONSTRAINT "school_website_photos_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "school_website_posts"("id") ON DELETE CASCADE,
  CONSTRAINT "school_website_photos_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "school_website_albums"("id") ON DELETE SET NULL,
  CONSTRAINT "school_website_photos_post_check" CHECK (("kind" = 'POST') = ("post_id" IS NOT NULL)),
  CONSTRAINT "school_website_photos_album_check" CHECK ("album_id" IS NULL OR "kind" = 'GALLERY')
);
CREATE INDEX "school_website_photos_school_id_kind_idx" ON "school_website_photos"("school_id", "kind");
CREATE INDEX "school_website_photos_post_id_idx" ON "school_website_photos"("post_id");

CREATE TABLE "school_website_reports" (
  "id"          TEXT         NOT NULL,
  "school_id"   TEXT         NOT NULL,
  "photo_id"    TEXT,
  "post_id"     TEXT,
  "reason"      TEXT         NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "resolved_by" TEXT,
  "resolution"  TEXT,

  CONSTRAINT "school_website_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "school_website_reports_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE,
  CONSTRAINT "school_website_reports_target_check" CHECK (("photo_id" IS NULL) <> ("post_id" IS NULL)),
  CONSTRAINT "school_website_reports_resolution_check" CHECK ("resolution" IS NULL OR "resolution" IN ('TAKEN_DOWN', 'DISMISSED'))
);
CREATE INDEX "school_website_reports_school_id_resolved_at_idx" ON "school_website_reports"("school_id", "resolved_at");

-- RLS: every table keyed on the school's GUC, FORCE so even the owner role obeys.
ALTER TABLE "school_websites"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_websites"        FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_website_posts"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_website_posts"   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_website_albums"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_website_albums"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_website_photos"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_website_photos"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "school_website_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "school_website_reports" FORCE  ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "school_websites"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
CREATE POLICY "tenant_isolation" ON "school_website_posts"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
CREATE POLICY "tenant_isolation" ON "school_website_albums"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
CREATE POLICY "tenant_isolation" ON "school_website_photos"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
CREATE POLICY "tenant_isolation" ON "school_website_reports"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

-- Owner holds "*"; admin gets website.manage. Idempotent.
UPDATE "roles"
SET "permissions" = "permissions" || (
  SELECT COALESCE(jsonb_agg(p), '[]'::jsonb)
  FROM jsonb_array_elements_text('["website.manage"]'::jsonb) AS p
  WHERE NOT ("roles"."permissions" @> jsonb_build_array(p))
)
WHERE "school_id" IS NULL AND "key" = 'admin' AND "is_system" = true;
