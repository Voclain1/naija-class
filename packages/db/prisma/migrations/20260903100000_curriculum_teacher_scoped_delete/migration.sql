-- Grant `curriculum.delete` to the teacher role.
--
-- The CP2 rollup withheld it, so that only owner and admin could delete a
-- curriculum document. Two things were wrong with that.
--
-- The REASONING was thinner than it looked. It rested on "deleting cascades
-- chunks and changes what every other teacher's lesson plans are grounded in",
-- but a curriculum document is scoped to ONE (subject, class level), so the
-- people affected are essentially that subject's own teachers. What the
-- protection actually needs to guard is a teacher deleting a COLLEAGUE'S
-- material — not a teacher correcting their own.
--
-- The PRACTICAL EFFECT was worse, and is why this is being fixed rather than
-- merely revisited: NOBODY could delete through the UI. The curriculum page
-- lives under the teacher route group and loads its dropdowns from
-- /teacher-scope/me, which is gated on the `teacher` ROLE with no owner/admin
-- bypass — so an admin, who held the permission, could not load the page at
-- all, while a teacher, who could, lacked the permission. It took a dual-role
-- account to delete anything, and no system role grants that combination.
--
-- The permission is only the coarse gate. CurriculumService.remove enforces the
-- substantive rule: owner and admin may delete any document; a teacher may
-- delete only one whose `uploaded_by` is their own user id. That is the same
-- guard/service division the rest of this codebase uses — the guard says "this
-- surface exists for you", the service says "this ROW is yours".
--
-- Idempotent, matching every prior RBAC-rollup migration, and
-- packages/db/src/seeds/system-roles.ts is updated in the same PR so a fresh
-- `pnpm db:seed` produces exactly this.
--
-- Admin already holds it from the CP2 rollup; owner holds the '*' wildcard.
-- No SECURITY DEFINER functions added — count stays at 22.

UPDATE "roles"
SET "permissions" = "permissions" || '["curriculum.delete"]'::jsonb
WHERE "key" = 'teacher'
  AND "is_system" = true
  AND NOT ("permissions" @> '["curriculum.delete"]'::jsonb);
