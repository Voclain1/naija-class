-- Phase 8 / CP1 — national events seed: 2026 and 2027 (D24).
-- Plan-first: docs/modules/phase-8.md §15.
--
-- DATA migration. This is also the ONLY kind of write national_events accepts
-- (D22): corrections and next year's list arrive as further migrations of this
-- shape, keyed on `key`, never through runtime code.
--
-- SOURCING RULES (D24), applied row by row below:
--   * Dates the Ministry of Interior has declared carry that declaration's URL
--     and date_confirmed = true. Every 2026 date below was checked against
--     interior.gov.ng on 2026-09-13.
--   * Fixed-date holidays not yet declared for their year (Independence,
--     Christmas, Boxing Day 2026; all fixed dates of 2027) are date_confirmed =
--     true with the Act, or the observed practice, as source. The calendar date
--     is not in doubt; only a possible substitute day is, and those are never
--     derived (below).
--   * Good Friday / Easter Monday 2027: Gregorian Easter is deterministic
--     (Easter Sunday 28 March 2027), so date_confirmed = true.
--   * The three Eids of 2027 are ESTIMATES (lunar calendar, moon-sighting
--     dependent): date_confirmed = false, rendered "expected" until the
--     Ministry declares them and a follow-up migration confirms each.
--   * Weekend substitute days and ad hoc special days (e.g. a presidential
--     inauguration) are NEVER seeded from a rule or a third-party list — only
--     once announced. Third-party calendars already list "tentative" 2027
--     substitutes (3 May, 14 June); none are included.
--
-- ONE ROW PER CONSECUTIVE RUN OF DECLARED DAYS. A two-day Eid declared on
-- consecutive days is one row (start..end). Easter is two rows because Friday
-- and Monday are not consecutive — a single 3–6 April range would wrongly show
-- the weekend as declared. Precedent that this matters: Eid-ul-Adha 2025 was
-- declared for Friday 6 and Monday 9 June.
--
-- IDEMPOTENT: ON CONFLICT (key) DO NOTHING.
--
-- Runs as the migration role. national_events is FORCE RLS with no write
-- policy, so this INSERT succeeds only for a role that bypasses RLS: school_kit
-- is SUPERUSER locally and BYPASSRLS on production (verified 2026-09-13). If a
-- future environment's migration role lacks both, this fails loudly inside the
-- migration transaction rather than half-applying.

INSERT INTO "national_events"
  ("id", "key", "name", "start_date", "end_date", "kind", "date_confirmed", "source", "updated_at")
VALUES
  -- ---------------------------------------------------------------- 2026
  (gen_random_uuid()::text, 'new-year-2026', 'New Year''s Day',
   '2026-01-01', '2026-01-01', 'PUBLIC_HOLIDAY', true,
   'https://interior.gov.ng/fg-declares-december-25-26-2025-and-january-1-2026-public-holidays-to-mark-christmas-boxing-day-and-new-year-celebrations/',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'eid-el-fitr-2026', 'Eid-el-Fitr',
   '2026-03-19', '2026-03-20', 'PUBLIC_HOLIDAY', true,
   'https://interior.gov.ng/federal-government-declares-thursday-19th-and-friday-20th-march-2026-as-public-holidays-to-mark-eid-ul-fitr/',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'good-friday-2026', 'Good Friday',
   '2026-04-03', '2026-04-03', 'PUBLIC_HOLIDAY', true,
   'https://interior.gov.ng/fg-declares-friday-3rd-and-monday-6th-april-2026-as-public-holidays-to-mark-easter-celebration/',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'easter-monday-2026', 'Easter Monday',
   '2026-04-06', '2026-04-06', 'PUBLIC_HOLIDAY', true,
   'https://interior.gov.ng/fg-declares-friday-3rd-and-monday-6th-april-2026-as-public-holidays-to-mark-easter-celebration/',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'workers-day-2026', 'Workers'' Day',
   '2026-05-01', '2026-05-01', 'PUBLIC_HOLIDAY', true,
   'https://interior.gov.ng/fg-declares-friday-1st-may-2026-as-public-holiday-to-mark-2026-workers-day-celebration/',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'eid-el-kabir-2026', 'Eid-el-Kabir (Eid-ul-Adha)',
   '2026-05-27', '2026-05-28', 'PUBLIC_HOLIDAY', true,
   'https://interior.gov.ng/federal-government-declares-wednesday-27th-may-and-thursday-28th-may-2026-as-public-holidays-to-mark-eid-ul-adha-celebration/',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'democracy-day-2026', 'Democracy Day',
   '2026-06-12', '2026-06-12', 'PUBLIC_HOLIDAY', true,
   'https://interior.gov.ng/federal-government-declares-june-12-2026-public-holiday-in-commemoration-of-democracy-day/',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'eid-el-maulud-2026', 'Eid-el-Maulud',
   '2026-08-25', '2026-08-25', 'PUBLIC_HOLIDAY', true,
   'https://interior.gov.ng/fg-declares-tuesday-public-holiday-as-nation-marks-eid-ul-mawlid/',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'independence-day-2026', 'Independence Day',
   '2026-10-01', '2026-10-01', 'PUBLIC_HOLIDAY', true,
   'Public Holidays Act (National Day, 1 October — fixed date)',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'christmas-day-2026', 'Christmas Day',
   '2026-12-25', '2026-12-25', 'PUBLIC_HOLIDAY', true,
   'Public Holidays Act (Christmas Day — fixed date)',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'boxing-day-2026', 'Boxing Day',
   '2026-12-26', '2026-12-26', 'PUBLIC_HOLIDAY', true,
   'Fixed date, observed federally — e.g. https://interior.gov.ng/fg-declares-december-25-26-2025-and-january-1-2026-public-holidays-to-mark-christmas-boxing-day-and-new-year-celebrations/',
   CURRENT_TIMESTAMP),

  -- ---------------------------------------------------------------- 2027
  (gen_random_uuid()::text, 'new-year-2027', 'New Year''s Day',
   '2027-01-01', '2027-01-01', 'PUBLIC_HOLIDAY', true,
   'Public Holidays Act (New Year''s Day — fixed date)',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'eid-el-fitr-2027', 'Eid-el-Fitr',
   '2027-03-09', '2027-03-10', 'PUBLIC_HOLIDAY', false,
   'ESTIMATE (lunar calendar; moon-sighting dependent) — awaiting Ministry of Interior declaration',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'good-friday-2027', 'Good Friday',
   '2027-03-26', '2027-03-26', 'PUBLIC_HOLIDAY', true,
   'Public Holidays Act (Good Friday); Easter Sunday 28 March 2027',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'easter-monday-2027', 'Easter Monday',
   '2027-03-29', '2027-03-29', 'PUBLIC_HOLIDAY', true,
   'Public Holidays Act (Easter Monday); Easter Sunday 28 March 2027',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'workers-day-2027', 'Workers'' Day',
   '2027-05-01', '2027-05-01', 'PUBLIC_HOLIDAY', true,
   'Public Holidays Act (Workers'' Day, 1 May — fixed date)',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'eid-el-kabir-2027', 'Eid-el-Kabir (Eid-ul-Adha)',
   '2027-05-16', '2027-05-17', 'PUBLIC_HOLIDAY', false,
   'ESTIMATE (lunar calendar; moon-sighting dependent) — awaiting Ministry of Interior declaration',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'democracy-day-2027', 'Democracy Day',
   '2027-06-12', '2027-06-12', 'PUBLIC_HOLIDAY', true,
   'Public Holidays Act as amended (Democracy Day, 12 June — fixed date)',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'eid-el-maulud-2027', 'Eid-el-Maulud',
   '2027-08-14', '2027-08-14', 'PUBLIC_HOLIDAY', false,
   'ESTIMATE (lunar calendar; moon-sighting dependent) — awaiting Ministry of Interior declaration',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'independence-day-2027', 'Independence Day',
   '2027-10-01', '2027-10-01', 'PUBLIC_HOLIDAY', true,
   'Public Holidays Act (National Day, 1 October — fixed date)',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'christmas-day-2027', 'Christmas Day',
   '2027-12-25', '2027-12-25', 'PUBLIC_HOLIDAY', true,
   'Public Holidays Act (Christmas Day — fixed date)',
   CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'boxing-day-2027', 'Boxing Day',
   '2027-12-26', '2027-12-26', 'PUBLIC_HOLIDAY', true,
   'Fixed date, observed federally — e.g. https://interior.gov.ng/fg-declares-december-25-26-2025-and-january-1-2026-public-holidays-to-mark-christmas-boxing-day-and-new-year-celebrations/',
   CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
