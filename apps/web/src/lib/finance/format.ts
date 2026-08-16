// Moved to packages/types/src/finance/format.ts on 2026-08-15 so that
// apps/mobile can share the one implementation — React Native cannot import
// from apps/web. Re-exported here so this module's ten existing import sites
// are unchanged.
//
// The invariant the original file asserted ("the ONLY place naira formatting
// lives in this codebase") is the reason this is a re-export and not a copy.
export { formatKobo } from "@school-kit/types";
