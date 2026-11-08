-- Additive only. Existing tenant RLS on report_cards and explicit school-id
-- scoping on schools remain authoritative; no new tables or privileges.
ALTER TABLE schools ADD COLUMN report_card_design JSONB;
ALTER TABLE report_cards ADD COLUMN report_profile JSONB;
ALTER TABLE schools ADD CONSTRAINT schools_report_card_design_object CHECK (report_card_design IS NULL OR jsonb_typeof(report_card_design) = 'object');
ALTER TABLE report_cards ADD CONSTRAINT report_cards_report_profile_object CHECK (report_profile IS NULL OR jsonb_typeof(report_profile) = 'object');
