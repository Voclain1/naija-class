# School website: the front page, by plan

Plan-first, 2026-10-22. Decisions answered by the owner 2026-10-22 (below).
Started by the owner the same day; **built 2026-10-22** (see "As built" at
the end, including what differs from this plan). Builds on
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

## As built (2026-10-22)

**What differs from the plan above.**
- **Photos are resized in the browser**, not on the server: the editor makes a
  1600 px JPEG and a 480 px thumbnail through a canvas before upload
  (`apps/web/src/lib/school-website/resize.ts`). This also drops EXIF,
  location included. The API only checks both are JPEGs within size (3 MB and
  512 KB), so it needs no image library on Fly or the VPS.
- **The staff app** came a day later (2026-10-24): see "Staff app (as built)"
  below.
- **The report queue** is a count on `schools.website_open_reports`, so
  SchoolKit's queue never reads across schools' reports and no SECURITY
  DEFINER function was needed (count stays 23).

**Data.** Migration `20261118120000_school_website`:
- `school_websites` (draft and published details, as JSON checked by
  `websiteDetailsSchema`), `school_website_posts`, `school_website_albums`,
  `school_website_photos` (`no_pupils_confirmed_by` NOT NULL: W4) and
  `school_website_reports`. FORCE RLS on all five, keyed on the school's GUC
  (`policies/school-website.sql`).
- `school_events.show_on_website`; `announcements.show_on_website`, with a
  CHECK that only EVERYONE or PARENTS announcements can carry it.
- `website.manage` for admin (owner holds `*`).

**Plan levels.** `WEBSITE_PLAN_LIMITS` and `websiteLimitsFor` in
`@school-kit/types`: the top tier under `PLAN_ENFORCEMENT=warn`, the plan's
own under `enforce`. The public page filters by them; the editor refuses only
adding past them (more gallery photos, photos on a post, publishing news on
Free). Nothing is deleted when a plan stops covering a section.

**API.**
- Staff (`website.manage`, owner and admin):
  - `GET /school-website`, `PUT /school-website/draft`, `POST /school-website/publish`.
  - `POST /school-website/preview`: a 30-minute link to the page with the
    draft (an HMAC of the school and expiry under the result-checker key,
    label `website-preview:v1:`).
  - `GET|POST /school-website/photos` (multipart `file` + `thumb` +
    `noPupils=true`), `PATCH|DELETE /school-website/photos/:id`.
  - `POST|PATCH|DELETE /school-website/albums[/:id]`.
  - `GET|POST /school-website/posts`, `PATCH|DELETE /school-website/posts/:id`,
    `POST …/:id/publish`, `POST …/:id/unpublish`.
  - `POST /announcements/:id/website` (`{ show }`); events carry
    `showOnWebsite` on create and update.
- Public (throttled): `GET /school-addresses/:code` now carries `website`
  (and takes `?preview=`); `GET /school-addresses/:code/news?page=`,
  `GET /school-addresses/:code/news/:postId`, `GET /school-addresses/:code/gallery`,
  `POST /school-addresses/:code/reports` (5 an hour per address).
- SchoolKit: `GET /platform-admin/website-reports`,
  `GET /platform-admin/schools/:id/website`,
  `POST /platform-admin/schools/:id/website/take-down`,
  `POST /platform-admin/schools/:id/website/reports/:reportId/dismiss`.
- Every write is audited (`website.*`, `announcement.website`,
  `platform_admin.website.*`); a public report writes `website.report`.

**Portal.** The front page (`/school/[code]`) shows, in order: cover and
welcome, sign in, for families (with the admissions box), announcements,
coming up, news, about us, quick facts, leadership, gallery, contact. New
pages `/school/[code]/news`, `/news/[postId]` and `/gallery`; on a school's own
address they are `/news`, `/news/<id>` and `/gallery` (middleware). Every
gallery and post photo has **Report this photo**. The accent colour tints
headings and the Apply button; the footer is "Powered by SchoolKit" on the top
tier.

**Web.** Settings → School website (`/settings/website`, also in the menu
under communication): status with Preview and Publish, then tabs for page
details, news and the gallery. Locked sections say which plan opens them
(tinted, never hidden). The event form and the announcement composer have
**Show on the school website**; the announcements list can switch it later.
The super-admin dashboard lists schools with reports, and Manage → Website
reviews any school's photos and posts with **Take down**.

**Tests.** `school-website.service.spec.ts` (real database and disk): plan
levels, the tick, preview tokens, events and announcements (including the
database CHECK), draft/preview/publish, another school's photo refused,
non-JPEG refused, sections hidden not deleted, admin yes / teacher no, posts
and per-post caps, the gallery and its cap, reports and take-downs (photos and
posts), files deleted with a post, RLS. Portal `middleware.spec.ts`; web
`resize.spec.ts`; e2e `school-website.spec.ts`.

## Staff app (as built, 2026-10-24)

News and the gallery, as planned under "The editor"; the page details stay on
the website (the menu row links there).

- **Who:** owners and admins: `website.manage` and the owner or admin role,
  because the API checks both (`staffDestinations`, key `website-news`, in
  *School*). Teachers do not see it.
- **Screens** (`apps/mobile/app/staff/website/`):
  - `index.tsx`: the news list with each post's status in words, **Write a
    post**, **Photo gallery** and **Preview the page** (the 30-minute preview
    link, opened in the browser). The plan note uses the web's words
    (`sectionPlanNote`).
  - `post/[id].tsx` (`new` for a new post): title and body with a character
    count, saved as a draft first because photos belong to a saved post; then
    photos (up to the plan's per-post limit), **Publish** / **Take off the
    website**, **Edit** and **Delete**. A taken-down post is read-only, with
    SchoolKit's reason.
  - `gallery.tsx`: the count against the plan's cap, upload with an optional
    caption into an optional album, albums (add, rename, delete; deleting an
    album keeps its photos), and per-photo caption, album and delete.
- **The tick (W4):** `WebsitePhotoUpload` (`src/components/website-photo-upload.tsx`)
  shows the rule and "This photo shows no pupils"; **Take a photo** and
  **Choose a photo** stay disabled until it is ticked, and it clears after
  each upload, so it is given per photo.
- **Resizing on the phone:** `expo-image-manipulator` (native, so it lands
  with the next app build) makes the 1600 px JPEG and the 480 px thumbnail,
  with the web's quality steps (`src/lib/staff/website-photo.ts`). Re-encoding
  writes a new JPEG, so the photo's location data is dropped, as on the web.
- **One API change:** the app's native uploader (`uploadMultipart`) sends one
  file per request, so the thumbnail travels as the `thumbBase64` form field
  beside the `file` part. `uploadWebsitePhotoSchema` takes it (base64, at most
  the 512 KB thumbnail limit), the controller decodes it, and the service's
  JPEG and size checks apply exactly as to a `thumb` part. The web still sends
  `thumb`. Proven by `school-website.controller.spec.ts` (both shapes, a PNG
  thumbnail refused, text that is not base64 refused, no thumbnail refused,
  the tick still required).
- **Tests:** `src/lib/staff/website.spec.ts` (sizes, statuses, plan notes,
  limits, album grouping, the post form), `destinations.spec.ts` (owner and
  admin yes; a teacher, even holding the permission, no).

