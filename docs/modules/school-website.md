# School website: the front page, by plan

Plan-first, 2026-10-22. **Waiting for the owner's Start.** Builds on
`docs/modules/school-addresses.md`, which gave every school its address and
the basic front page.

## Why

The owner's brief: the school's front page should be "rich with
school-specific data". A form in Settings lets the owner change the page's
details, post announcements and updates (pictures, events), "so the front page
looks like a page". Free schools keep the basic page; paid plans get richer
pages, by level.

## What every school already has (built 2026-10-22)

- **Header:** the school's logo (SchoolKit's when it has none), name and motto.
- **Sign in:** buttons for parents and staff, and the school code for students.
- **For families:** Apply and Check results, when open.
- **Contact:** the school's address, phone and email.
- **Footer:** one line, `© <year> SchoolKit`.

This stays the Free page, exactly as the owner described it.

## Proposed: what each plan adds

| Section | Free | Starter | Growth | Professional / Enterprise |
|---|---|---|---|---|
| Basic page (above) | ✓ | ✓ | ✓ | ✓ |
| **Cover:** a wide photo and a one-line welcome | | ✓ | ✓ | ✓ |
| **About us:** a welcome from the head, the school's story | | ✓ | ✓ | ✓ |
| **Quick facts:** founded, levels taught, curriculum, boarding/day | | ✓ | ✓ | ✓ |
| **News and updates:** posts with text and up to 4 photos each | 3 latest | 10 latest | all, with an archive page | all |
| **Events:** upcoming calendar events the school marks "Show on website" | | ✓ | ✓ | ✓ |
| **Announcements:** ones the school marks "Show on website" | | | ✓ | ✓ |
| **Photo gallery** | | | up to 60 photos | up to 300 |
| **Leadership:** names, roles and photos the school enters | | | ✓ | ✓ |
| **Admissions box:** fees range, entry classes, a "Visit us" note | | | ✓ | ✓ |
| **Colours:** an accent colour from a safe set | | | | ✓ |
| **Own domain**, e.g. `www.virgofidelis.edu.ng` (after the VPS move) | | | | ✓ |
| **"Powered by SchoolKit"** footer | ✓ | ✓ | ✓ | small |

The free column's "3 latest" posts is a suggestion. You described Free as
having no front page beyond the basics, so it could be none. Your call.

## How it works

- **One editor:** **Settings → School website**, owner and admins.
  - Every section shows a tick or a lock.
  - A locked section says which plan opens it, but is never hidden, so schools
    can see what they would get.
  - **Preview** opens the page as a family will see it, before publishing.
- **Reuses what the school already writes.**
  - **Events:** the calendar gains a "Show on the school website" tick.
  - **Announcements:** the same tick, so nothing is typed twice.
  - **Posts:** website news only, separate from announcements (announcements
    go to parents' phones; posts are public).
- **Photos:**
  - Stored the same way as logos.
  - Resized on upload.
  - Shown through short-lived links that the page renews on each visit.
  - Caps per plan, as above.
- **Children in photos (NDPR):**
  - Before a photo of children goes on the public page, the poster ticks: "The
    parents of every child shown have agreed to this photo being public."
  - No child's name is ever shown with a photo.
  - SchoolKit's operator can take down any post or photo from the platform
    admin.
  - Every publish and take-down is audited.
- **Plan levels follow `PLAN_ENFORCEMENT`, like report-card branding.**
  - **During early access (`warn`):** every school can use every section, with
    a note saying which plan it needs later.
  - **Once you switch to `enforce`:** sections above a school's plan stop
    showing on its page. Nothing is deleted, so upgrading brings them straight
    back.

## Slices (one PR)

1. **Page details:** cover photo, welcome, about, quick facts, leadership, the
   admissions box, and the editor with preview.
2. **News and photos:** posts with photos, the gallery, the consent tick, the
   operator take-down, and per-plan caps.
3. **Events and announcements:** the "Show on website" tick, the events and
   announcements sections, and the plan locks on the page.

Own domains and colours come later, after the VPS move.

## Decisions for the owner

1. **Free plan:** no posts at all, or the 3 latest?
2. **The table:** is the split by plan right?
3. **Early access:** everyone gets everything while `PLAN_ENFORCEMENT` is
   `warn`, as with report cards?
4. **The children's-photo consent tick:** is that wording right, or do you want
   photos of children kept off public pages entirely?
