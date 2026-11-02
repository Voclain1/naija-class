-- Subjects by class (2026-11-02, docs/modules/subjects-by-class.md): KG is a
-- stage of its own, beside Nursery. On its own migration because Postgres
-- refuses to use an enum value in the transaction that adds it; the next
-- migration moves KG classes onto it.
ALTER TYPE "ClassStage" ADD VALUE IF NOT EXISTS 'KG' AFTER 'NURSERY';
