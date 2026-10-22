# School website: the front page, by plan

Plan-first, 2026-10-22. Decisions answered by the owner 2026-10-22 (below).
**Waiting for the owner's Start.** Builds on
`docs/modules/school-addresses.md`, which gave every school its address and
the basic front page.

## Why

The owner's brief: the school's front page should be "rich with
school-specific data". A form in Settings lets the owner change the page's
details, post announcements and updates (pictures, events), "so the front page
looks like a page". Free schools keep a plain page; paid plans get richer
pages, by level.

## Decisions (owner, 2026-10-22)

- **W1. Free has no news.** Free schools get no news posts. They can show
  their own events and announcements, as below.
- **W2. The split by plan stands.** The table below gives the details.
- **W3. Early access gets everything.** While `PLAN_ENFORCEMENT` is `warn`,
  every school can use every section, with a note saying which plan it will
  need. This works like report-card branding.
- **W4. No children on public pages.** Photos of pupils never go on the
  school's public page. There is no consent tick to get around this. See
  "Photos" below for how the rule is held.

## What every school already has (built 2026-10-22)

- **Header:** the school's logo (SchoolKit's when it has none), name and motto.
- **Sign in:** buttons for parents and staff, and the school code for students.
- **For families:** Apply and Check results, when open.
- **Contact:** the school's address, phone and email.
- **Footer:** one line, `© <year> SchoolKit`.

## What each plan adds

| Section | Free | Starter | Growth | Professional / Enterprise |
|---|---|---|---|---|
| Basic page (above) | ✓ | ✓ | ✓ | ✓ |
| **Events** the school marks "Show on website" | next 3 | next 10 | all upcoming | all upcoming |
| **Announcements** the school marks "Show on website" | latest 3 | latest 10 | latest 20 | latest 20 |
| **Cover:** a wide photo and a one-line welcome | | ✓ | ✓ | ✓ |
| **About us:** a welcome from the head, the school's story | | ✓ | ✓ | ✓ |
| **Quick facts** | | ✓ | ✓ | ✓ |
| **News:** posts with text and photos | | 10 latest, 2 photos each | all, 4 photos each, archive page | all, 4 photos each, archive page |
| **Photo gallery** | | | up to 60 photos | up to 300 photos |
| **Leadership:** names, roles, photos | | | up to 6 | up to 12 |
| **Admissions box** | | | ✓ | ✓ |
| **Accent colour** from a safe set | | | | ✓ |
| **Own domain**, e.g. `www.virgofidelis.edu.ng` (after the VPS move) | | | | ✓ |
| **Footer** | `© SchoolKit` | `© SchoolKit` | `© SchoolKit` | a small "Powered by SchoolKit" |

## Each section in detail

**Events.**
- The calendar's event form gains a tick: **Show on the school website**.
  It is off by default.
- The page shows upcoming events only, soonest first: the title, the date or
  dates, and the description.
- The page never shows RSVP details or replies; those stay in the portal.
- Editing or deleting the event in the calendar changes the page at once.
- Nothing is typed twice.

**Announcements.**
- Only whole-school announcements (Everyone or Parents) offer the tick.
- Staff-only and single-class announcements never appear on the public page,
  and the API refuses them.
- The tick is set when the announcement is sent. Because an announcement is
  never edited, the tick can be switched off later, but the text cannot change.
- A withdrawn announcement leaves the page at once.
- **The page shows the title, the date and the text.** It never shows who
  sent it or who has read it.
- A warning under the tick says: "Anyone on the internet can read this."

**Cover.**
- One wide photo, resized to 1600 px wide, and a welcome line of up to 120
  characters.
- Without a photo, the cover is a plain tinted band behind the welcome line.

**About us.**
- A welcome from the head, with the head's name and title, up to 1,200
  characters.
- Our story, up to 2,000 characters.
- Plain paragraphs only, no formatting. This keeps pages tidy and safe.

**Quick facts.** All are optional; an empty fact is not shown.
- Year founded.
- Levels taught: Crèche, Nursery, Primary, JSS, SSS. The Settings page
  suggests these from the school's classes.
- Curriculum: Nigerian, British, American, Montessori, or the school's own
  words.
- Day, boarding, or both.
- Boys, girls, or mixed.

**News.**
- Each post has a title, a body of up to 3,000 characters, photos, and a date.
- Posts can be drafts, published, or taken down.
- Posts appear newest first. Growth and above get a `/news` archive page, with
  each post at `/news/<post>`.
- News is for the public only. It does not notify parents' phones;
  announcements do that.

**Gallery.**
- Photos with an optional caption of up to 140 characters, in albums
  ("Sports day 2026", "Our new library").
- Albums are optional, and every photo counts toward the plan's cap.
- Same photo rules as below.

**Leadership.**
- Each person has a name, a role ("Proprietress", "Principal"), and an
  optional photo.
- Shown in the order the school sets.
- Adults only, by the photo rule.

**Admissions box.** Shown only while admissions are open.
- Entry classes, picked from the school's class levels.
- A fees range, typed as text. Fees are never worked out here, so the
  hard rule against computing fees on the page is not touched. The text is
  the school's own words, e.g. "₦180,000 – ₦250,000 a term".
- A "Visit us" note, up to 300 characters.
- The Apply button.

**Accent colour.**
- One of 8 colours, each checked for readable text on both light and dark
  backgrounds.
- It is used for buttons and headings only, never for borders.

## Photos

**The rule (W4): no pupils on public pages.**
- Every photo upload (cover, news, gallery, leadership) asks the uploader to
  tick: **"This photo shows no pupils."**
  - Without the tick, the photo cannot be published.
  - This tick is not consent. It is the uploader saying the photo shows no
    children.
- The help text says it plainly: buildings, classrooms, staff, events without
  pupils, trophies and the school bus are fine; pupils are not, even from
  behind or in a crowd.
- SchoolKit's operator can take any photo or post down from the platform
  admin, with a reason.
  - The school sees the reason in Settings.
  - The photo stays hidden, and the school cannot republish it.
- A report link on the public page ("Report this photo") lets a parent flag a
  photo to SchoolKit, so a mistake comes to us rather than lingering.
- Every publish, take-down and report is audited.
- SchoolKit cannot spot children in photos by machine, so the rule relies on
  the tick, the report link and take-down. This is said in the onboarding
  guide.

**Storage.**
- Photos are stored the way logos are.
- Each one is resized on upload: a large 1600 px version and a small 480 px
  thumbnail.
- Location data in the photo file (EXIF) is removed.
- JPEG, PNG or WebP, up to 8 MB before resizing.
- The page is served through short-lived signed links, renewed on each visit.
- Deleting a photo deletes its files.

## Plan levels

- **While `PLAN_ENFORCEMENT` is `warn` (W3):** every section is open to every
  school. Settings shows a note on each section: "Growth plan — included free
  during early access."
- **Once it is `enforce`:**
  - Sections above the school's plan stop showing on its page. Nothing is
    deleted, so upgrading brings them straight back.
  - Caps (news count, gallery photos, leadership) show the newest items up to
    the cap.
  - A school above its photo cap can still see all its photos in Settings, but
    cannot upload more.

## The editor: Settings → School website

- **Who can use it:** the owner and admins, through a new permission,
  `website.manage`. Owners and admins get it by default.
- **Layout:** one page with a card per section. Each card has an on/off switch
  and its fields.
- **Locked sections:** when enforced, a locked section shows which plan opens
  it. It is never hidden.
- **Preview** opens the page exactly as families will see it, including
  unpublished changes.
- **Publish** makes the page live.
  - Page details (cover, about, facts, leadership, admissions box) are saved
    as one draft and published together.
  - News posts are published one by one.
- **Staff app:** a slimmer version, with news posts and photos only. Writing
  the about pages is easier on a computer.

## Data (outline)

- **`school_websites`**: one row per school.
  - The published and draft page details, as checked JSON.
  - The cover photo key.
  - The accent colour.
  - Updated by and at.
- **`school_website_posts`**: news posts.
  - Title, body, status, published date and author.
  - Take-down fields: by, at and reason.
- **`school_website_photos`**: every photo.
  - Owner type: cover, post, gallery or leader.
  - Storage keys, caption, album, and the "no pupils" tick with who ticked it.
  - Take-down fields.
- **`school_website_albums`**: gallery albums.
- **`school_events.show_on_website`** and **`announcements.show_on_website`**:
  booleans, default false.
- **RLS:** every new table has FORCE RLS keyed on the school's GUC.
- **The public page** reads through a public service that resolves the school
  code first, as `SchoolPublicService` does now.
  - It returns only published, untaken-down items.
  - It applies the plan caps.
- **No SECURITY DEFINER function is needed**, because once the code is
  resolved the school is known. The count stays at 23.

## Slices (one PR)

1. **Events and announcements on the website:** the two ticks, the public
   sections, and the plan caps. This is the part Free gets.
2. **Page details:** cover, about, quick facts, leadership, admissions box,
   colour, the editor, and the preview.
3. **News and photos:** posts, the gallery, the photo rule, the report link,
   operator take-down, and the per-plan caps.

Own domains come later, after the VPS move.
