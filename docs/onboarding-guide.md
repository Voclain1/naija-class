# Getting started with schoolkit

This guide walks a school owner through setting up schoolkit for the first time, in the order that actually works — each stage depends on the one before it. Follow it top to bottom on your first visit; after that, you can jump to whichever section you need.

Every screen name, button label, and field name below is taken directly from the live app, not from memory — if something on your screen doesn't match this guide exactly, check the [Troubleshooting & FAQ](#troubleshooting--faq) section first, then ask for help.

**Bursar or teacher? Most of this guide is the owner/admin setup sequence — here's what's actually yours:**

- **Bursar** — start at [Fee catalog](#9-fee-catalog) and [Generate invoices](#10-generate-invoices) (payments, installment plans, and cancel/reverse all live on an individual invoice page there too). The [Troubleshooting & FAQ](#troubleshooting--faq) entries on Paystack test mode and recording payments are yours as well.
- **Teacher** — start at [Report cards: build → score entry → sign-off → approval → release](#13-report-cards-build--score-entry--sign-off--approval--release) for the Gradebook and Report Cards workflow. The FAQ entry "A teacher can't see their class in the gradebook" is yours too.

Everything else below (signup, the setup wizard, academic structure, staff invites, students, fee catalog *setup*, guardian invites) is owner/admin work — useful background if you're curious how the school got configured, but not something you'll do day to day.

**Where you are in this process at a glance:**

1. [Create your account](#1-create-your-account)
2. [Set up your school](#2-set-up-your-school-the-5-step-wizard)
3. [Academic structure: years, terms, class levels, class arms](#3-academic-structure-years-terms-class-levels-class-arms)
4. [Grading scheme](#4-grading-scheme)
5. [Subjects](#5-subjects)
6. [Class-subject matrix](#6-class-subject-matrix)
7. [Staff and teacher assignment](#7-staff-and-teacher-assignment)
8. [Students: add or import](#8-students-add-or-import)
9. [Fee catalog](#9-fee-catalog)
10. [Generate invoices](#10-generate-invoices)
11. [Invite guardians to the parent portal](#11-invite-guardians-to-the-parent-portal)
12. [The guardian (parent) portal](#12-the-guardian-parent-portal)
13. [Report cards: build → score entry → sign-off → approval → release](#13-report-cards-build--score-entry--sign-off--approval--release)
14. [Troubleshooting & FAQ](#troubleshooting--faq)

---

## 1. Create your account

Go to **/signup**.

Fill in:

- **School name**
- **Slug (your subdomain)** — lowercase letters, digits, hyphens only. This becomes `your-slug.schoolkit.ng`.
- **First name** / **Last name** (yours, as the school owner)
- **Email**
- **Phone** — include the country code, e.g. `+234...`
- **Password** — at least 8 characters, with one letter and one digit
- Tick the NDPR consent checkbox: *"I accept the data handling terms and confirm I'm authorised to create an account for this school under NDPR."*

Click **Create school**.

This creates your account and immediately starts the 5-step setup wizard.

---

## 2. Set up your school (the 5-step wizard)

Right after signup you land on **/onboarding/1**, a 5-step wizard. A progress indicator at the top shows which step you're on. You can always go back to a previous step to change something.

### Step 1 — School basics (`/onboarding/1`)

- **School name**
- **Motto** (optional)
- **Address** (optional)
- **Phone**
- **Email**

Click **Continue**.

### Step 2 — Branding (`/onboarding/2`)

- **Logo (optional)** — the logo uploader. Click it to choose an image file; it uploads immediately when you pick the file, separately from the rest of this form.
- **Primary colour (optional)** — a hex code, e.g. `#1A2B3C`. This doesn't change how the app looks yet, but is saved for later.

Both fields are optional — you can leave this step blank and add a logo later from **Settings → School**. Click **Continue**.

### Step 3 — Invite admins (`/onboarding/3`)

Optional. If you want other administrators or bursars in the school from day one, click **Add invite**, fill in **Email** (required), **First name** and **Last name** (optional), and repeat for as many people as you like. Click **Send N invite(s)** when done, or **Skip for now** to move on and invite people later from Settings.

### Step 4 — Data protection consent (`/onboarding/4`)

Reads a plain-language summary of what schoolkit does with your data. Tick *"I have read and accept the data handling terms above on behalf of my school"* and click **Confirm and continue**.

### Step 5 — You're all set (`/onboarding/5`)

Click **Go to dashboard** to finish setup and land on your admin dashboard.

> **Logo/colour later:** if you skipped branding, or want to change it, go to **Settings → School** at any time — it has the same logo upload widget.

---

## 3. Academic structure: years, terms, class levels, class arms

All of this lives under **Settings → Academic**, which has five tabs in the order you should use them: **Years → Class Levels → Class Arms → Subjects → Matrix**.

### Academic years (`/settings/academic/years`)

Click **Add academic year**. Fill in:
- **Label** — e.g. `2025/2026`
- **Start date**
- **End date**

Click **Create year**.

### Terms (from a year's row, click **View terms**)

Each year holds up to 3 terms. On a year's terms page, click **Add term** (this button disappears once all 3 terms exist) and fill in:
- **Sequence** (1–3)
- **Name** — auto-fills to "First Term" / "Second Term" / "Third Term"
- **Start date** / **End date** (must fall inside the academic year's own dates)

Click **Create term**.

**Marking the current term:** on either the years list or a year's terms list, click **Set current** next to the term (or year) you want active. Setting a term current automatically also marks its parent year as the current year — you only need to do this once per term change, not twice.

### Class levels (`/settings/academic/class-levels`)

The 14 standard Nigerian levels (KG 1 through SSS 3) are already there — seeded automatically when your school was created. You only need this page if you want to add a custom level or rename a default one. Click **Add class level** and fill in **Name**, **Code**, **Stage** (Nursery / Primary / JSS / SSS), and **Order**.

**Every level — seeded or custom — already has one arm.** A default arm (e.g. "JSS 1" gets "JSS 1A") is created automatically the moment a level exists, so if your school runs one stream per level, you can go straight to enrolling students without visiting Class Arms at all. It's an ordinary arm like any other — rename it, deactivate it, or add more arms alongside it any time.

### Class arms (`/settings/academic/class-arms`)

An arm is a specific class, e.g. "JSS 1A". You only need this page if you want to **rename the auto-created default arm** or **add a second (or third) arm** under a level — e.g. "JSS 1A" and "JSS 1B" for a two-stream school. Click **Add class arm** and fill in:
- **Class level** — pick from your existing levels (you need at least one level before this button is enabled)
- **Name** — e.g. `JSS 1A`
- **Code**
- **Capacity** (optional)
- **Class teacher** (optional) — pick the arm's homeroom/form teacher from the dropdown, or leave it as **— None —**. Only staff invited with the Teacher role appear here; if you haven't invited any teachers yet, this shows a prompt to invite one first (see [§7](#7-staff-and-teacher-assignment)).

Click **Create arm**. You can change the class teacher later from **Edit** on the same row.

---

## 4. Grading scheme

Go to **Settings → Grading** (separate from the Academic tabs — it has its own two-tab sub-nav: **Scheme** and **Boundaries**).

### Scheme (`/settings/grading`)

Defines how a subject's term score splits across continuous assessment and exams — one scheme applies to every subject in your school. A default is seeded already. To change it: click **Add component** to add a row (**Key**, e.g. `ca1`; **Label**, e.g. `First CA`; **Weight**), use the up/down arrows to reorder, and the trash icon to remove a row. A badge shows **"Weights total: N / 100"** — you can't save until it reads 100. Click **Save scheme**.

### Boundaries (`/settings/grading/boundaries`)

Maps total scores to letter grades. Defaults to the WAEC nine-point scale. Click **Add band** to add a row (**Grade**, e.g. `A1`; **Min**; **Max**; **Remark**, e.g. `Excellent`). A badge confirms **"Ranges tile 0–100"** — bands must cover 0–100 with no gaps or overlaps before you can save. Click **Save boundaries**.

---

## 5. Subjects

Go to **Settings → Academic → Subjects** (`/settings/academic/subjects`).

Click **Add subject** and fill in:
- **Name** — e.g. `Mathematics`
- **Code** — e.g. `maths`
- **Category** — Core / Elective / Vocational

Click **Create subject**. Repeat for every subject your school teaches.

---

## 6. Class-subject matrix

Go to **Settings → Academic → Matrix** (`/settings/academic/class-subjects`) — do this after you have at least one subject and one class level, or the page will prompt you to go create them first.

This is a grid: rows are your class levels, columns are your subjects. **Click a cell** to link a subject to a level. On a linked cell, click the small **C**/**E** pill to toggle Core vs. Elective for that pairing.

Changes aren't saved automatically — a bar appears at the bottom reading **"N row(s) have unsaved changes"** with **Discard** and **Save changes** buttons. Save is per class-level row, so if something fails partway through you'll see how many rows saved successfully.

---

## 7. Staff and teacher assignment

Go to **Staff** (`/staff`).

### Inviting one person

Click **Invite staff**. Fill in **Email**, **Role** (Admin / Bursar / Teacher), and optionally **First name** / **Last name**. Click **Send invitation**.

**Staff invitations are not emailed automatically** — after sending, you'll see an **Accept link** with a **Copy** button. Copy it and send it to the person yourself (WhatsApp, email, however you'd normally reach them). The link expires in 7 days and works once.

> This is the opposite of guardian invitations, which *are* emailed for you — see [§11](#11-invite-guardians-to-the-parent-portal). Don't assume a teacher received anything until you've sent them the link.

### Inviting many teachers at once

Click **Import teachers (CSV)** from the Staff page (or from the invite form, which cross-links to it). It's a 4-step wizard: **Upload → Map columns → Review → Import**. Download the **Template CSV** first if you're not sure of the column format (just email, first name, surname). After you upload, you'll map your CSV's columns to Email/First name/Last name, review which rows are ready, then click **Invite N teacher(s)**. Like single invites, there's no automated email — accept links are generated per person; you copy and send them.

### Assigning a teacher to teach a subject in a class

Open a staff member's page (**Staff → [name]**). Under **"Teaching assignments"**, click **Add assignment** and choose **Class arm**, **Subject**, **Academic year**, and **Term** (leave Term as "Whole year" unless it's a short-term cover). Click **Add assignment**. This is what lets a teacher see and grade that subject/class in their gradebook — a teacher with no assignments here won't see any classes to grade.

### Assigning a homeroom/form teacher

Separately from the above, a class arm can also have a **form teacher** — the person responsible for that class's report-card sign-off. Set this from the **Class teacher** dropdown on the class arm itself (**Settings → Academic → Class Arms → Edit**, see [§3](#3-academic-structure-years-terms-class-levels-class-arms)), not from the staff page. Only staff with the Teacher role can be picked. Once set, that teacher gets a **Report Cards** item in their own portal nav and can open, sign off, and submit their arm's report cards for review — you're no longer the only one who can do it.

---

## 8. Students: add or import

Go to **Students** (`/students`). Three ways to get students in:

### One at a time

Click **Add student**. Required: **Admission number**, **Date of birth**, **First name**, **Last name**, **Gender**. Everything else (phone, email, address, state of origin, nationality, religion, blood group, photo URL, medical notes) is optional and can be filled in later. Click **Create student**.

### Several at once, by hand

Click **Add multiple**. This opens a spreadsheet-style grid starting with 3 blank rows (click **Add row** for more). Fill in the same required fields per row, then click **Create students**. Rows submit one at a time — if one fails, the ones that already succeeded stay created.

### From a CSV

Click **Import students**. Same 4-step wizard shape as the staff import: **Upload → Map columns → Review → Import**. Download the **Template CSV** if needed. On the mapping step, also set the **Date format** your CSV uses (defaults to `DD/MM/YYYY`, the Nigerian convention). Review the "Ready to import" vs. "Needs fixing" rows, then click **Commit N student(s)**.

> None of these three paths enrolls a student into a class arm or links a guardian — those are separate steps: bulk class-arm enrollment lives at **/enrollments/bulk**, and guardians are added from each student's own page (see [§11](#11-invite-guardians-to-the-parent-portal)).

---

## 9. Fee catalog

Go to **Settings → Finance → Fees** (`/settings/finance/fees`).

This is a two-panel screen: **Categories** on the left, that category's **items** on the right.

1. Click **New** to create a category — e.g. `Tuition`, `PTA Levy`. Fill in **Name** and an optional **Description**.
2. Select the category, then click **Add item**. Fill in:
   - **Name** — e.g. `First Term Tuition`
   - **Amount (₦ naira)** — type the amount in naira; schoolkit stores it as kobo internally, the page shows you the conversion
   - **Scope (all optional)** — restrict the item to a specific **Class level**, **Class arm**, **Academic year**, and/or **Term**. Leave all four blank for a school-wide fee.

You need at least one category and one item before invoice generation has anything to charge.

*(Optional, and can be set up any time: **Settings → Finance → Discounts** lets you manually assign a percentage, fixed amount, or full waiver to an individual student against a specific fee item or category, for a term, a full session, or indefinitely.)*

---

## 10. Generate invoices

Go to **Finance → Invoices** (`/finance/invoices`), **Generate** tab (the default tab).

1. Pick **Academic year**, then **Term**, then **Class arm**.
2. Optionally set a **Due date**.
3. Click **Preview** to see, per student, what would be charged — this doesn't create anything yet.
4. Click **Generate invoices**. You'll see a result like *"Done — N invoice(s) created, N skipped (already issued)."* (Skipped means that student already has an invoice for this term/scope — generating again won't double-charge.)

Switch to the **Invoice list** tab to see everything generated, filterable by status (Draft, Issued, Partially paid, Paid, Overdue, Cancelled, Refunded). Click an invoice to open it.

**On an individual invoice page** you can:
- **Record payment** — for cash, POS, or bank transfer received outside the app. Enter **Amount (₦)**, **Method**, **Date paid**, and an optional **Reference**, then click **Record payment**. *(This is today's real-money path — see the [FAQ](#troubleshooting--faq) on Paystack.)*
- **Pay via Paystack** — click **Pay outstanding balance** to send the parent-facing link, or use this yourself; currently in **test mode** (see FAQ).
- Set up an **installment plan** if the family wants to pay in parts.
- **Cancel invoice** or **Reverse** an individual payment (with a required reason), if needed.

---

## 11. Invite guardians to the parent portal

Open the student's page and go to the **Guardians** tab.

### Adding a guardian to a student

Click **Add guardian**. You get two modes:
- **Link existing** — search an already-recorded guardian by name or phone and link them to this student too (useful for siblings).
- **Create new** — fill in **First name**, **Last name**, **Relationship** (Father, Mother, Guardian, Uncle, Aunt, Grandparent, Sibling, Other), **Phone**, and optionally **Email**, **Occupation**, **Employer**, **Address**, **Notes**.

Tick **Set as primary guardian** and/or **Allowed to pick up** as appropriate, then click **Link guardian** or **Create and link**.

### Inviting them to the portal

Once a guardian has an email on file, click **Invite to portal** on their row. **schoolkit emails the invitation to the guardian automatically** — you don't need to send it yourself.

The accept link is also shown to you on screen with a **Copy** button, as a backup for when a guardian says they never got the email (check their spam folder first). **That on-screen link is shown only once** — if you navigate away before copying it, just send a fresh invitation.

> **Text-message invites** are supported but **off by default**. Turn them on under **Settings → Notifications** if you'd rather reach guardians by SMS as well as email.

> **Staff invitations are different** — those are *not* emailed automatically, and you do have to copy the link and send it yourself. See [§7](#7-staff-and-teacher-assignment).

### Bulk guardian import

If you have many guardians to add at once, click **Bulk import guardians from CSV** on the Guardians tab. Same 4-step wizard pattern (**Upload → Map columns → Review → Import**), matching guardians to students by **admission number**.

---

## 12. The guardian (parent) portal

This is a separate app from the admin/teacher side, at the portal's own address (ask if you don't know your school's portal URL).

1. The guardian opens the accept link you sent, sets a password, ticks the NDPR consent checkbox, and clicks **Set password and continue**.
2. From then on, they log in at the portal's **Log in** page with **Email** / **Password**.
3. They land on **Your children** — a list of the students linked to them. Selecting a child shows that child's **Invoices**, each with a **Total due**, **Paid so far**, and **Balance**.
4. If a balance is owed, a **Pay ₦[amount]** button appears — it always charges the full outstanding balance (there's no partial-amount entry) and redirects to Paystack checkout.

---

## 13. Report cards: build → score entry → sign-off → approval → release

This spans two roles and two screens.

### Score entry (teacher side, `/teacher/gradebook`)

A teacher with a subject assignment (see [§7](#7-staff-and-teacher-assignment)) picks a class and subject from their **Gradebook**, enters scores per component (CA1, CA2, Exam, etc. — as defined by your grading scheme), and clicks **Save**. Once every student has every score filled in, **Sign off column** becomes clickable — this locks the column against further edits (a **Re-open to edit** button appears if a correction is needed later, which clears the sign-off). The form teacher (or you) can then click **Recompute positions** to rank the class.

### Building and progressing the report cards

Owner/admin work from **Report Cards** in the admin sidebar (`/report-cards`); a class's form teacher works from the same **Report Cards** item in their own portal nav (`/teacher/report-cards`) — same picker and workflow board either way, just scoped to the arms you're allowed to touch. Pick a term and class arm from the picker to open that class's workflow board.

1. **Build report cards** — pulls together every subject's signed-off (or in-progress) scores into one report card per student. Status starts at **Draft**.
2. Open an individual card to write the **Form teacher's comment** (editable while the card is Draft or "Subjects reviewed").
3. Click **Form-review arm** — moves the whole arm's cards to **Form reviewed**.
4. As owner/admin, open a card and write the **Principal's remark** (this one field applies to every card in the arm at once), then click **Approve arm** — moves to **Principal approved**.
5. Click **Release arm** — moves to **Released** and starts generating PDFs in the background. Once ready, **Download PDF** appears per card (and **Regenerate** if one fails).
6. If something needs correcting after the fact, **Reopen arm** (owner only) rolls the whole arm back to Draft — it asks for a reason, which is logged.

> Every one of these stage-transition buttons (Build, Form-review, Approve, Release, Reopen) acts on the *whole class arm at once*, not one student at a time.

> AI-assisted comment drafting is not in the app yet — per schoolkit's own rule, when it ships it will always require this same manual sign-off before anything is final. For now, every comment is typed by a person.

---

## Troubleshooting & FAQ

**The app is unusually slow the first time I open it after a while.**
This is a known, current limitation: the database goes to sleep after about 5 minutes of no activity to save cost, and the very first request after that has to wake it back up, which can take longer than normal. It only affects the first load — everything after that is normal speed until it goes idle again. If a page seems stuck, wait a few extra seconds before assuming something's broken.

**Online payment (Paystack) says "test mode" — what does that mean?**
schoolkit's online payment integration is still going through provider approval. While it's in test mode, a parent clicking **Pay** on the portal will not actually be charged real money, and the portal shows a clear notice about this above any unpaid invoice. **Until this is switched on, use the school office for real payments**, and record them yourself:
- On any invoice's page (**Finance → Invoices → [invoice]**), use the **Record payment** section to log cash, POS, or bank transfer payments as they come in. This immediately updates that invoice's balance and the guardian's view — it does not depend on Paystack at all.

**A teacher can't see their class in the gradebook.**
Check **Staff → [teacher] → Teaching assignments** — they need at least one assignment there (class arm + subject) for the current term/year. No assignment, no visible class.

**Invitation links (staff or guardian) — where do they go, and can I get one back?**
The two work differently:

- **Guardian invitations are emailed automatically.** The guardian gets the accept link in their inbox as soon as you click **Invite to portal**. (Text-message invites are also supported, but off unless you enable them under **Settings → Notifications**.)
- **Staff invitations are not emailed.** When you invite an admin, bursar, or teacher, the accept link is shown to you on-screen with a **Copy** button — copy it and send it to them yourself, however you'd normally reach them.

In both cases the on-screen link is shown **only once**. If you navigate away before copying it, you can't retrieve that exact link again — send a fresh invite instead (you'll get an "invitation already pending" notice if one is still outstanding). For guardians that's rarely a problem, since they were emailed the link anyway.

**Something looks broken or won't save.**
Refresh the page first — some screens (like the class-subject Matrix) warn you before you navigate away if you have unsaved changes, so check for that. If it persists, note the exact page and what you clicked, and reach out for support.
