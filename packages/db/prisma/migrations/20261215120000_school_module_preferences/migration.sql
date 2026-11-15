-- School-selected navigation modules. NULL deliberately means legacy/full
-- access so this migration cannot hide a feature from an existing school.
-- New schools write their core selection explicitly during provisioning.
ALTER TABLE "schools" ADD COLUMN "module_preferences" JSONB;
