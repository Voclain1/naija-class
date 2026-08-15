// formatKobo — the ONLY place naira formatting lives in this codebase.
//
// Input is always kobo (the integer stored in the DB). DISPLAY LAYER ONLY:
// never call this in services, DTOs, or anything that sends data to the API.
// CLAUDE.md's Money rules are explicit that money is Int (kobo) in the DB and
// bigint in TS, formatted to naira only at the point of display.
//
// It lives in packages/types rather than in an app because there are now two
// display layers — apps/web and apps/mobile — and "the only place" has to
// stay literally true to be worth anything. apps/web/src/lib/finance/format.ts
// re-exports this so its ten existing import sites are unchanged; React Native
// cannot consume that path, which is what forced the move.
//
// BigInt arithmetic, not floating point, because Number cannot represent
// large kobo totals exactly and a school's termly billing can run to
// hundreds of millions of kobo.
export function formatKobo(kobo: number | bigint): string {
  const n = BigInt(Math.round(Number(kobo)));
  const whole = n / 100n;
  const frac = ((n % 100n) + 100n) % 100n; // handle negative remainders
  return `₦${whole.toLocaleString("en-NG")}.${String(frac).padStart(2, "0")}`;
}
