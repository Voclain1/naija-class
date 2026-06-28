// formatKobo — the only place naira formatting lives in this codebase.
// Input is always kobo (the integer stored in the DB). Display layer only.
// Never call this in services, DTOs, or anything that sends data to the API.
export function formatKobo(kobo: number | bigint): string {
  const n = BigInt(Math.round(Number(kobo)));
  const whole = n / 100n;
  const frac = ((n % 100n) + 100n) % 100n; // handle negative remainders
  return `₦${whole.toLocaleString("en-NG")}.${String(frac).padStart(2, "0")}`;
}
