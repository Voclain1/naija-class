
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

**Screens built (2026-09-24).** Five surfaces, on the server shipped above:

| Surface | What it is |
|---|---|
| `apps/web` `/announcements` | Compose and the outbox on one page, owner/admin. Nav entry gated on `announcement.create`, not `.read` — every staff role reads announcements, only owner/admin send, and gating on read would show a teacher a compose form the API refuses. |
| `apps/portal` `/announcements` | The parent's read view, linked from the home page with an unread count. |
| `apps/mobile` `/staff/announcements` | One screen, two jobs: the feed everybody reads, and compose + outbox for owner/admin. A head checking whether a message went out should not have to leave the screen they sent it from. |
| `apps/mobile` `/announcements`, `/me/announcements` | Parent and student read views, sharing one `AnnouncementFeed` renderer so the two cannot drift about what "unread" looks like. |

Decisions made while building the screens:

- **Reading marks it read.** There is no "mark as read" button anywhere. A
  reader with the message on screen HAS read it, and a button is one more
  thing to forget — which would leave a school looking at an unread count
  that means nothing. Every mark is fire-and-forget: a failed one leaves the
  item unread, the safe direction.
- **Every confirmation names the audience, not the action.** "Send to every
  parent?" rather than "Are you sure?", plus the plain sentence that an
  announcement cannot be unsent. Withdrawing removes it from the feeds; the
  phones have already buzzed.
- **Family feeds are persisted and readable offline; the staff ones are not.**
  "The gate is closed tomorrow" is exactly the message a parent needs on a bus
  with no signal. On the staff side a STAFF-audience announcement is internal
  and the outbox names its sender, so both keys carry the `staff` prefix that
  `mayPersistQuery` refuses.
- **The push hint finally lands somewhere.** The server has sent
  `data.screen = "announcements"` since the rail shipped; it fell through to
  HOME because no screen existed. `routes.ts` now maps it per principal.
