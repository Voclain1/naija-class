-- The school store's price list for parents (2026-10-19,
-- docs/modules/id-cards-and-store.md §4b). The school's own choice whether
-- parents see what the store sells and the price, on the portal and the parent
-- app. On by default: an item appears only once it has a selling price, so a
-- school that has not set up its store shows parents nothing either way.
-- `schools` has no RLS; no SECURITY DEFINER function is added or changed.
ALTER TABLE "schools" ADD COLUMN "store_prices_for_parents" BOOLEAN NOT NULL DEFAULT true;
