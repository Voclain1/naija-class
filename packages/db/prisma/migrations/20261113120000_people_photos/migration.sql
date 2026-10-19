-- Passport photos for students and staff (2026-10-19,
-- docs/modules/id-cards-and-store.md §2).
--
-- The photo itself is a private storage object (student-photo, staff-photo:
-- schools/<schoolId>/photos/{students|staff}/<id>.jpg). These columns only say
-- one exists and when it was last replaced, so a list can ask for signed links
-- for exactly the people who have a photo, and a replaced photo is not served
-- from a stale cache. students.photo_url (free text since Phase 1) is left as
-- it is: an uploaded photo takes precedence where both exist.
--
-- Both tables already have FORCE RLS; a nullable column needs nothing more.

ALTER TABLE "students" ADD COLUMN "photo_uploaded_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "photo_uploaded_at" TIMESTAMP(3);
