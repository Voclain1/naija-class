
## Status

**Server built (2026-09-23).** Schema (`announcements`, `announcement_reads`,
RLS ENABLE + FORCE), the `announcement.read` / `announcement.create`
permissions granted in the seeds AND backfilled onto existing roles by the
migration, the three controllers (staff, guardian, student), and delivery
through `EventNotifierService.announcementPosted`.

Two things worth recording because they were decided while building:

- **A CHECK constraint, not just the DTO:** `(audience = 'CLASS') =
  (class_arm_id IS NOT NULL)`. An audience disagreeing with its class would
  silently reach the wrong people, or nobody, and that is not a validation
  concern — it is an invariant.
- **`announcement_reads` has no `school_id` and no policy of its own.** It is
  reachable only through an announcement, whose policy already scopes it, and
  the FK cascades. FORCE RLS with no policy would make it unreadable to the
  runtime role; it is deliberately governed by its parent.

**Still to build:** the web admin list and compose, and the mobile surfaces
(staff compose/list, family read screens, the unread card).
