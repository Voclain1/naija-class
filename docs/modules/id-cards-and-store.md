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
  real upload: a JPEG, PNG or WebP up to 5 MB, cropped to passport shape
  (35 × 45) in the browser or the staff app.
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
