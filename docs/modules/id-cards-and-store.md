# ID cards and the Store

Proposed 2026-10-19 and approved the same day by the owner, with these
answers:

1. The menu names below: approved.
2. Blood group and parents' phone numbers stay off the card.
3. The public QR verification page: yes.
4. A fixed-assets register is part of the Store: yes, now.
5. A Storekeeper role, with the right permissions. The bursar has some
   control; the owner and admin have full control.

Shipped as two pull requests: **ID1** (menu names, photos, ID cards) and **ST**
(the Store, with fixed assets and the Storekeeper role).

## 1. Menu names (ID1)

Students and staff each get their own section, and the words are the ones a
Nigerian school office uses (British spelling: enrolment, programme, colour).

| Section | Pages |
|---|---|
| (alone) | Dashboard |
| Students | Students, Parents & guardians, Class enrolment, Admissions, Student ID cards |
| Staff | Staff, Staff ID cards |
| Academics | Timetable, Scheme of work, Lesson notes, Homework, Question bank |
| Examinations & results | Gradebook, Exam papers, CBT exams, Report cards, Result checker |
| Student welfare | Behaviour & discipline, Health records, Sickbay |
| Facilities | Transport, Hostels, Boarding, Library, Store |
| (alone) | Bursary (the Finance pages) |
| Communication | Messages, Announcements, School news, Events calendar |
| Reports | Reports, Insights |
| School setup | Sessions & classes, Grading, Settings |
| (alone) | My profile |

Teacher menu: Dashboard; My classes (Classes, Attendance, Homework, Behaviour,
My timetable); Lesson notes (Lesson notes, Scheme of work, Library resources);
Examinations & results; School (Calendar, Messages, School news, Boarding,
Admissions); Profile.

Only labels change: every address stays the same.

## 2. Photos (ID1)

- Today `students.photo_url` is free text and staff have no photo. Both get a
  real upload: any picture the browser or phone can open, cropped to passport
  shape (35 × 45) there and sent as a JPEG of at most 5 MB.
- Stored privately (`student-photo`, `staff-photo` storage keys, one object
  per person, extension-bearing like `school-logo`); shown through short-lived
  signed addresses. Wherever a student's photo already shows, the upload is
  used.
- Bulk upload: many files at once, each named by admission number
  (`SKA-0042.jpg`); unmatched names are listed, never guessed.
- Permissions: `student.update` for a student's photo, `user.update` (or the
  person themselves) for a staff photo.

## 3. ID cards (ID1)

- **Size:** ISO/IEC 7810 ID-1, 85.6 × 54 mm, the bank-card size every PVC card
  printer takes. Front and back.
- **Front:** school logo and colours, photo, name, class (students) or role
  (staff), admission or staff number, "Valid for 2026/2027", QR code.
- **Back:** "If found, please return to" the school's address and phone, a
  signature line, the card number. No date of birth, home address, blood
  group or parent's phone (owner's answer 2; NDPR minimum data).
- **Printing:** a print page with two layouts: A4 sheets of ten cards with cut
  marks, or one card per page at card size for a PVC printer. One card, a
  class, or all staff. People without a photo are listed before printing.
- **Cards are records:** each issue has a card number, the session it is valid
  for, and a status (active, cancelled, replaced). Reissuing a lost card
  cancels the old one.
- **QR verification (answer 3):** the code opens a public portal page showing
  only what the front shows (photo, name, class or role, school) and whether
  the card is valid, expired or cancelled. The code carries the school's slug,
  the card id and an HMAC under the server key, so a code cannot be forged or
  guessed; no SECURITY DEFINER function is needed (the school is resolved from
  its slug, the card read under that school's GUC).
- **Optional fee:** a school that charges for a card or a replacement can add
  it to the child's invoice through the existing student charges.
- **Apps:** the student app and the staff app show the card on screen with its
  QR code.
- **Permissions:** `id-card.read`, `id-card.issue`: owner and admin.

## 3a. As built (ID1, 2026-10-19)

**Menu.** As in §1, plus **Student ID cards** (`/id-cards/students`, Students
section) and **Staff ID cards** (`/id-cards/staff`, Staff section), so Staff
is now a two-page section. Old names stay as search words in **Find a page**
("finance", "guardians", "lesson plans", "online exams" and so on).

**Photos.**
- Migration `20261113120000_people_photos`: `photo_uploaded_at` on `students`
  and `users`. The old free-text `students.photo_url` stays, as the older
  typed-in address; an uploaded photo wins wherever both exist.
- Storage keys `student-photo` / `staff-photo`:
  `schools/<id>/photos/{students|staff}/<id>.jpg`, one object per person,
  overwritten in place.
- The browser crops to 35 × 45 and encodes a 420 × 540 JPEG
  (`apps/web/src/lib/photos/crop.ts`). The API takes JPEG only, by its first
  bytes, at most 5 MB (`PHOTO_MAX_BYTES`).
- Routes: `POST|DELETE /students/:id/photo` (student.update),
  `POST /students/photo-urls` (student.read, up to 200 ids, one-hour links),
  `POST|DELETE /users/:id/photo` (user.update, or yourself),
  `POST|DELETE /users/me/photo`, `POST /users/photo-urls` (anyone's with
  user.read, otherwise only your own). Audited as `student.photo.set|remove`
  and `staff.photo.set|remove`.
- `StudentDto`, `UserListItemDto` and the teacher roster carry `hasPhoto`;
  avatars ask for links in one batch (`usePhotoUrls`).
- Bulk upload: **Students → Photos** (`/students/photos`). Each file is named
  by admission number (case ignored), cropped around its centre, and sent in
  turn. Unmatched names are listed. Students who already have a photo are
  skipped unless **Replace** is ticked.
- Staff set their own photo under **My profile** (web) and on the staff
  app's profile screen. The app crops with the picker's own editor, which is
  passport-shaped on Android and square on iOS. The card fills its frame from
  the centre.

**ID cards.**
- Migration `20261114120000_id_cards`: `id_cards`, FORCE RLS
  `tenant_isolation`, one ACTIVE card per holder per session (partial unique
  indexes), CHECKs on the holder and on status versus `ended_at`.
  `id-card.read` and `id-card.issue` go to admin; the owner holds `*`.
- Card numbers are `ID-<first year of the session>-<5-digit running count>`.
  The count is per school, taken under a row lock on `schools`.
- Routes: `GET /id-cards?kind=&classArmId=` and `POST /id-cards/print`
  (id-card.read); `POST /id-cards/issue`, `/:id/cancel`, `/:id/reissue`
  (id-card.issue, with a reason); `GET /id-cards/me` (any staff);
  `GET /student-portal/me/id-card`; and the public
  `GET /id-card-check/:token`, limited to 30 a minute per address.
- Audited as `id-card.issue|cancel|reissue`. Reissue marks the old card
  REPLACED, links it to the new one, and keeps the session.
- QR code: `<portal>/id/<slug>.<card id>.<signature>`. The signature is a
  22-character HMAC of the card id under `RESULT_PIN_HMAC_KEY`, labelled
  `id-card:v1:` (`id-card-token.ts`). No SECURITY DEFINER function: the
  school comes from its slug (`schools` has no RLS), and the card is read
  under that school's GUC.
- What the check shows: valid, expired (Lagos date after the session's end),
  cancelled, replaced, or LEFT (added 2026-10-19: the card is still active but
  its holder is withdrawn, graduated or inactive, or a staff account is
  switched off; nothing cancels a card when its holder leaves), plus the photo (a five-minute link), name, class or
  role, school, session and card number. It does not show the admission
  number.
- Printing: `/id-cards/print`, in one of two layouts.
  - **A4**: ten a page, two by five, with a dashed cut line. The backs sheet
    is mirrored by row, so a long-edge double-sided print lines up.
  - **Card printer**: one card per page at 85.6 × 54 mm.
  - The QR is drawn in the browser (`react-qr-code`). People without a
    photo are named, with a link, before printing.
- Apps: the student app's **My ID card** screen and the staff profile show the
  card with its QR, drawn with plain Views from `qrcode-generator`, a new
  mobile dependency.
- Optional fee: not a new mechanism. After a student's replacement, the page
  points to the student's charges.

## 4. The Store (ST)

- **Items** with category (uniforms, textbooks, stationery, laboratory,
  sports, ICT, cleaning, kitchen, other), unit, code, reorder level, and
  optional sizes (variants), each with its own stock. Optional selling price
  and cost, in kobo.
- **Ledger:** every change is a movement, never an edit: receive (from a
  supplier, with cost), issue (to a student, staff member or department), sell
  (to a student, billed on the child's invoice through student charges),
  return, write-off (damaged or lost, with a reason), stock-take adjustment.
  Stock on hand is the sum of movements; every movement is audited.
- **Stock take:** a count sheet; counted quantities produce adjustments, which
  one person approves.
- **Low stock:** a dashboard line and a filter at or below the reorder level.
- **Fixed assets (answer 4):** a register of computers, projectors, furniture,
  laboratory equipment and the like: tag number, category, location, assigned
  to, condition, purchase date and cost, status (in use, under repair,
  disposed). Moves and condition changes are kept as history.
- **Reports:** stock on hand, stock value at average cost, movements, sales by
  term, the asset register; Excel, CSV and PDF.
- **Roles (answer 5):** a new **Storekeeper** role runs the Store day to day
  (items, receiving, issuing, stock takes, assets). The **bursar** sees stock
  value and reports, sells to students (billing) and approves stock-take
  adjustments, but does not edit items. **Owner and admin** have full control.

## 4a. As built (ST, 2026-10-19)

**Data.** Migration `20261115120000_store`:
- `store_items`, `store_item_variants`, `store_movements`,
  `store_stock_takes`, `store_stock_take_lines`, `fixed_assets` and
  `fixed_asset_events`, every one under FORCE RLS `tenant_isolation`. Child
  rows reference `(school_id, id)` of their parent, so a row cannot point
  across schools.
- `STORE` is added to `StudentChargeKind` (shown as "School store").
- Item codes and asset tags are unique per school, ignoring case. There is at
  most one live (open or submitted) stock take per school.

**Stock.** Stock lives on the variant (size). An item without sizes has one
unnamed variant. Adding the first size renames that variant, so stock already
received keeps its place. On hand is the sum of movement quantities. Value is
on hand × the weighted average cost of every RECEIVE that carried a cost.

**Ledger rules.**
- `store_movements` is append-only. A trigger refuses UPDATE and DELETE,
  except while a school is being deleted (`schools.deletion_started_at`).
- CHECKs: RECEIVE and RETURN are positive, ISSUE, SELL and WRITE_OFF are
  negative, ADJUST is either. A SELL needs a student, a price and a charge.
  WRITE_OFF and ADJUST need a reason.
- Every outgoing movement locks its variant row (`FOR UPDATE`) and refuses
  to take stock below zero (`NOT_ENOUGH_STOCK`).
- A sale raises a student charge through `StudentChargeService.raise` in the
  same transaction. The charge has kind `STORE`, `sourceModule` `store` and
  the movement's id as `sourceId`, and is billed for the current term
  (`chargeTermFor`). It rides on the term invoice or a supplementary one, like
  every other charge.
- **A return gives no refund.** Taking back a sold item puts it back in
  stock and nothing else. If the family is owed money, the bursar voids the
  charge if it has not been billed, or records a credit through Bursary.
  Refunds are deliberately left to Bursary, not the Store.

**Stock takes.** A stock take is started with one line per active variant.
Counts are saved, then the take is submitted, which freezes each line's
expected stock. Approving it (`store.approve`) writes one ADJUST movement per
counted line that differs (counted − expected at submission). Anything issued
or received between submission and approval is therefore kept, not undone.
Uncounted lines change nothing. A take can be cancelled until it is approved.

**Assets.** The register keeps tag, category, location, holder (a member of
staff or free text), condition, status, purchase date, cost, serial number and
supplier. Every change is written to `fixed_asset_events`: ADDED, MOVED,
ASSIGNED, CONDITION, STATUS, EDITED or DISPOSED, with an optional note. A
disposed asset is frozen. The register hides disposed assets unless that
status is chosen.

**Routes** (all under `/api/v1`):

| Route | Permission |
|---|---|
| `GET /store/items` (`?q=&category=&low=true&includeInactive=true`), `GET /store/items/:id` | `store.read` |
| `POST /store/items`, `PATCH /store/items/:id`, `POST /store/items/:id/variants`, `PATCH /store/variants/:id` | `store.manage` |
| `POST /store/movements` | SELL: `store.sell`. Everything else: `store.manage` |
| `GET /store/movements` (`?itemId=&kind=&from=&to=`) | `store.read` |
| `GET /store/people` (student or staff search for the forms) | `store.manage` or `store.sell` |
| `GET /store/stock-takes`, `GET /store/stock-takes/:id` | `store.read` |
| `POST /store/stock-takes`, `PUT …/:id/counts`, `POST …/:id/submit` | `store.manage` |
| `POST …/:id/approve` | `store.approve` |
| `POST …/:id/cancel` | `store.manage` or `store.approve` |
| `GET /store/reports/stock`, `GET /store/reports/sales` (`?from=&to=`) | `store.read` |
| `GET /assets`, `GET /assets/:id` | `asset.read` |
| `POST /assets`, `PATCH /assets/:id`, `POST /assets/:id/dispose` | `asset.manage` |

Audited as `store.item.create|update`, `store.variant.add|update`,
`store.movement.<kind>`, `store.stocktake.start|submit|approve|cancel`, and
`asset.create|update|dispose`.

**Who holds what.**

| Role | Permissions |
|---|---|
| Owner | everything (`*`) |
| Admin | all six store and asset permissions |
| Storekeeper (new) | `store.read`, `store.manage`, `asset.read`, `asset.manage`, `export.table` |
| Bursar | `store.read`, `store.sell`, `store.approve`, `asset.read` |

A storekeeper signs in to the Store (`/store`). The role is offered in
**Staff → Invite staff**.

**Screens.**
- Web: **Facilities → Store** (`/store`), with tabs for Items, Stock takes,
  Reports and Assets. The item page has the movement buttons and the sizes.
  Low rows are tinted and labelled **Low**. Lists export to Excel, CSV and
  PDF.
- Dashboard: a "Store items running low" line, linking to `/store?low=true`.
- Staff app: a read-only **Store** screen with stock on hand and a
  **Running low** filter. Receiving, selling and stock takes stay on the
  website.
