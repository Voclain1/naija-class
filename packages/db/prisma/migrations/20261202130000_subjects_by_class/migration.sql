-- Subjects by class (2026-11-02, docs/modules/subjects-by-class.md).
--
-- 1. subjects.stages: the stages a subject is taught in. A class's subjects
--    are the school's active subjects tagged with the class's stage, so
--    deleting, adding or re-staging a class needs no remapping. class_subjects
--    stays (nothing reads it for results; it was only ever the matrix).
-- 2. subject_hides: a subject hidden from results for one arm, one level or
--    the whole school, for a term, a session or until unhidden. Tenant-scoped
--    under FORCE RLS like every school table. No SECURITY DEFINER function;
--    the count stays 23.
-- 3. Existing schools, one at a time under that school's own GUC (so RLS
--    applies whatever role runs this):
--    a. classes whose code or name starts KG (or Kindergarten) move from the
--       Nursery stage to KG;
--    b. each subject's stages are taken from its class_subjects links;
--    c. the standard subject list (packages/db/src/seeds/subject-catalogue.ts)
--       is added: a subject the school already has, matched on its name or
--       code (lower-case, letters and digits only, against the entry's name,
--       code and aliases), gains the entry's stages; a missing one is added.
--       Nothing is deleted or renamed.

ALTER TABLE "subjects" ADD COLUMN "stages" "ClassStage"[] NOT NULL DEFAULT ARRAY[]::"ClassStage"[];

CREATE TABLE "subject_hides" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "class_arm_id" TEXT,
    "class_level_id" TEXT,
    "until" TEXT NOT NULL,
    "term_id" TEXT NOT NULL,
    "academic_year_id" TEXT NOT NULL,
    "hidden_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unhidden_at" TIMESTAMP(3),
    "unhidden_by" TEXT,
    CONSTRAINT "subject_hides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "subject_hides_scope_check" CHECK (
      ("scope" = 'ARM' AND "class_arm_id" IS NOT NULL AND "class_level_id" IS NULL)
      OR ("scope" = 'LEVEL' AND "class_level_id" IS NOT NULL AND "class_arm_id" IS NULL)
      OR ("scope" = 'SCHOOL' AND "class_arm_id" IS NULL AND "class_level_id" IS NULL)
    ),
    CONSTRAINT "subject_hides_until_check" CHECK ("until" IN ('TERM', 'YEAR', 'INDEFINITE'))
);
CREATE INDEX "subject_hides_school_id_unhidden_at_idx" ON "subject_hides"("school_id", "unhidden_at");
CREATE INDEX "subject_hides_subject_id_idx" ON "subject_hides"("subject_id");
ALTER TABLE "subject_hides" ADD CONSTRAINT "subject_hides_school_id_fkey"
  FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subject_hides" ADD CONSTRAINT "subject_hides_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subject_hides" ADD CONSTRAINT "subject_hides_class_arm_id_fkey"
  FOREIGN KEY ("class_arm_id") REFERENCES "class_arms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subject_hides" ADD CONSTRAINT "subject_hides_class_level_id_fkey"
  FOREIGN KEY ("class_level_id") REFERENCES "class_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subject_hides" ADD CONSTRAINT "subject_hides_term_id_fkey"
  FOREIGN KEY ("term_id") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subject_hides" ADD CONSTRAINT "subject_hides_academic_year_id_fkey"
  FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subject_hides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subject_hides" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "subject_hides"
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE TEMP TABLE "subject_catalogue_2026" (
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" "SubjectCategory" NOT NULL,
  "stages" "ClassStage"[] NOT NULL,
  "keys" TEXT[] NOT NULL
) ON COMMIT DROP;
INSERT INTO "subject_catalogue_2026" ("code", "name", "category", "stages", "keys") VALUES
  ('number-work', 'Number Work', 'CORE'::"SubjectCategory", ARRAY['NURSERY']::"ClassStage"[], ARRAY['numberwork', 'numbers']),
  ('letter-work', 'Letter Work', 'CORE'::"SubjectCategory", ARRAY['NURSERY']::"ClassStage"[], ARRAY['letterwork', 'letters']),
  ('rhymes-songs', 'Rhymes and Songs', 'CORE'::"SubjectCategory", ARRAY['NURSERY']::"ClassStage"[], ARRAY['rhymesandsongs', 'rhymessongs', 'rhymes', 'songs']),
  ('colouring-drawing', 'Colouring and Drawing', 'CORE'::"SubjectCategory", ARRAY['NURSERY']::"ClassStage"[], ARRAY['colouringanddrawing', 'colouringdrawing', 'colouring', 'drawing', 'coloring']),
  ('nature-study', 'Nature Study', 'CORE'::"SubjectCategory", ARRAY['NURSERY']::"ClassStage"[], ARRAY['naturestudy']),
  ('physical-play', 'Physical Play', 'CORE'::"SubjectCategory", ARRAY['NURSERY']::"ClassStage"[], ARRAY['physicalplay']),
  ('social-habits', 'Social Habits', 'CORE'::"SubjectCategory", ARRAY['NURSERY', 'KG']::"ClassStage"[], ARRAY['socialhabits']),
  ('health-habits', 'Health Habits', 'CORE'::"SubjectCategory", ARRAY['NURSERY', 'KG']::"ClassStage"[], ARRAY['healthhabits']),
  ('literacy', 'Literacy', 'CORE'::"SubjectCategory", ARRAY['KG']::"ClassStage"[], ARRAY['literacy', 'literacyenglish', 'englishliteracy']),
  ('numeracy', 'Numeracy', 'CORE'::"SubjectCategory", ARRAY['KG']::"ClassStage"[], ARRAY['numeracy']),
  ('phonics', 'Phonics', 'CORE'::"SubjectCategory", ARRAY['KG']::"ClassStage"[], ARRAY['phonics']),
  ('handwriting', 'Handwriting', 'CORE'::"SubjectCategory", ARRAY['KG', 'PRIMARY']::"ClassStage"[], ARRAY['handwriting', 'writing']),
  ('rhymes-poems', 'Rhymes and Poems', 'CORE'::"SubjectCategory", ARRAY['KG']::"ClassStage"[], ARRAY['rhymesandpoems', 'rhymespoems', 'poems']),
  ('creative-arts', 'Creative Arts', 'CORE'::"SubjectCategory", ARRAY['KG']::"ClassStage"[], ARRAY['creativearts', 'art', 'arts']),
  ('english', 'English Language', 'CORE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['englishlanguage', 'english', 'englishstudies', 'eng']),
  ('math', 'Mathematics', 'CORE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['mathematics', 'math', 'maths', 'generalmathematics']),
  ('basic-science', 'Basic Science', 'CORE'::"SubjectCategory", ARRAY['KG', 'JSS']::"ClassStage"[], ARRAY['basicscience']),
  ('basic-science-technology', 'Basic Science and Technology', 'CORE'::"SubjectCategory", ARRAY['PRIMARY']::"ClassStage"[], ARRAY['basicscienceandtechnology', 'basicsciencetechnology', 'bst']),
  ('social-studies', 'Social Studies', 'CORE'::"SubjectCategory", ARRAY['KG', 'PRIMARY', 'JSS']::"ClassStage"[], ARRAY['socialstudies']),
  ('civic-education', 'Civic Education', 'CORE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['civiceducation', 'civic', 'civics']),
  ('security-education', 'Security Education', 'CORE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS']::"ClassStage"[], ARRAY['securityeducation']),
  ('physical-health-education', 'Physical and Health Education', 'CORE'::"SubjectCategory", ARRAY['KG', 'PRIMARY', 'JSS']::"ClassStage"[], ARRAY['physicalandhealtheducation', 'physicalhealtheducation', 'phe']),
  ('crs', 'Christian Religious Studies', 'ELECTIVE'::"SubjectCategory", ARRAY['NURSERY', 'KG', 'PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['christianreligiousstudies', 'crs', 'crk', 'christianreligiousknowledge', 'bibleknowledge']),
  ('irs', 'Islamic Religious Studies', 'ELECTIVE'::"SubjectCategory", ARRAY['NURSERY', 'KG', 'PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['islamicreligiousstudies', 'irs', 'irk', 'islamicreligiousknowledge', 'islamicstudies']),
  ('cultural-creative-arts', 'Cultural and Creative Arts', 'CORE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS']::"ClassStage"[], ARRAY['culturalandcreativearts', 'culturalcreativearts', 'cca', 'culturalandcreativeart']),
  ('computer-studies', 'Computer Studies', 'CORE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS']::"ClassStage"[], ARRAY['computerstudies', 'computer', 'ict', 'informationtechnology', 'digitaltechnologies']),
  ('agricultural-science', 'Agricultural Science', 'ELECTIVE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['agriculturalscience', 'agric', 'agriculture', 'agricscience']),
  ('home-economics', 'Home Economics', 'ELECTIVE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS']::"ClassStage"[], ARRAY['homeeconomics', 'homeecons']),
  ('history', 'History', 'ELECTIVE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['history']),
  ('french', 'French', 'ELECTIVE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['french', 'frenchlanguage']),
  ('yoruba', 'Yoruba', 'ELECTIVE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['yoruba', 'yorubalanguage']),
  ('igbo', 'Igbo', 'ELECTIVE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['igbo', 'igbolanguage']),
  ('hausa', 'Hausa', 'ELECTIVE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['hausa', 'hausalanguage']),
  ('arabic', 'Arabic', 'ELECTIVE'::"SubjectCategory", ARRAY['PRIMARY', 'JSS', 'SSS']::"ClassStage"[], ARRAY['arabic', 'arabiclanguage']),
  ('verbal-reasoning', 'Verbal Reasoning', 'ELECTIVE'::"SubjectCategory", ARRAY['PRIMARY']::"ClassStage"[], ARRAY['verbalreasoning', 'verbalaptitude']),
  ('quantitative-reasoning', 'Quantitative Reasoning', 'ELECTIVE'::"SubjectCategory", ARRAY['PRIMARY']::"ClassStage"[], ARRAY['quantitativereasoning', 'quantitativeaptitude']),
  ('basic-technology', 'Basic Technology', 'CORE'::"SubjectCategory", ARRAY['JSS']::"ClassStage"[], ARRAY['basictechnology', 'introtech', 'introductorytechnology']),
  ('business-studies', 'Business Studies', 'ELECTIVE'::"SubjectCategory", ARRAY['JSS']::"ClassStage"[], ARRAY['businessstudies']),
  ('biology', 'Biology', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['biology']),
  ('chemistry', 'Chemistry', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['chemistry']),
  ('physics', 'Physics', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['physics']),
  ('further-mathematics', 'Further Mathematics', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['furthermathematics', 'furthermaths', 'fmaths']),
  ('geography', 'Geography', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['geography']),
  ('technical-drawing', 'Technical Drawing', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['technicaldrawing', 'td']),
  ('data-processing', 'Data Processing', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['dataprocessing']),
  ('economics', 'Economics', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['economics']),
  ('government', 'Government', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['government']),
  ('literature-in-english', 'Literature in English', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['literatureinenglish', 'literature', 'litinenglish']),
  ('commerce', 'Commerce', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['commerce']),
  ('financial-accounting', 'Financial Accounting', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['financialaccounting', 'accounting', 'accounts', 'bookkeeping']),
  ('marketing', 'Marketing', 'VOCATIONAL'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['marketing']),
  ('office-practice', 'Office Practice', 'VOCATIONAL'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['officepractice']),
  ('insurance', 'Insurance', 'VOCATIONAL'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['insurance']),
  ('visual-arts', 'Visual Arts', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['visualarts', 'fineart', 'finearts']),
  ('music', 'Music', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['music']),
  ('food-nutrition', 'Food and Nutrition', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['foodandnutrition', 'foodnutrition']),
  ('physical-education', 'Physical Education', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['physicaleducation']),
  ('health-education', 'Health Education', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['healtheducation']),
  ('animal-husbandry', 'Animal Husbandry', 'VOCATIONAL'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['animalhusbandry']),
  ('catering-craft', 'Catering Craft Practice', 'VOCATIONAL'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['cateringcraftpractice', 'cateringcraft', 'catering']),
  ('garment-making', 'Garment Making', 'VOCATIONAL'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['garmentmaking']),
  ('computer-science', 'Computer Science', 'ELECTIVE'::"SubjectCategory", ARRAY['SSS']::"ClassStage"[], ARRAY['computerscience']);

DO $$
DECLARE
  sch RECORD;
  cat RECORD;
  matched TEXT;
  new_code TEXT;
BEGIN
  FOR sch IN SELECT "id" FROM "schools" LOOP
    PERFORM set_config('app.current_school_id', sch."id", true);

    UPDATE "class_levels"
    SET "stage" = 'KG'
    WHERE "school_id" = sch."id"
      AND "stage" = 'NURSERY'
      AND (lower("code") LIKE 'kg%' OR lower("name") LIKE 'kg%' OR lower("name") LIKE 'k.g%'
           OR lower("name") LIKE 'kindergarten%');

    UPDATE "subjects" sub
    SET "stages" = COALESCE((
      SELECT array_agg(DISTINCT cl."stage" ORDER BY cl."stage")
      FROM "class_subjects" cs
      JOIN "class_levels" cl ON cl."id" = cs."class_level_id"
      WHERE cs."subject_id" = sub."id"
    ), ARRAY[]::"ClassStage"[])
    WHERE sub."school_id" = sch."id";

    FOR cat IN SELECT * FROM "subject_catalogue_2026" LOOP
      SELECT s."id" INTO matched
      FROM "subjects" s
      WHERE s."school_id" = sch."id"
        AND (regexp_replace(lower(s."name"), '[^a-z0-9]', '', 'g') = ANY(cat."keys")
             OR regexp_replace(lower(s."code"), '[^a-z0-9]', '', 'g') = ANY(cat."keys"))
      ORDER BY s."created_at"
      LIMIT 1;

      IF matched IS NOT NULL THEN
        UPDATE "subjects"
        SET "stages" = (SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest("stages" || cat."stages") AS x),
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = matched;
      ELSE
        new_code := cat."code";
        IF EXISTS (SELECT 1 FROM "subjects" WHERE "school_id" = sch."id" AND "code" = new_code) THEN
          new_code := cat."code" || '-std';
        END IF;
        INSERT INTO "subjects" ("id", "school_id", "name", "code", "category", "stages", "is_active", "created_at", "updated_at")
        VALUES (gen_random_uuid()::text, sch."id", cat."name", new_code, cat."category", cat."stages", true,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.current_school_id', '', true);
END $$;
