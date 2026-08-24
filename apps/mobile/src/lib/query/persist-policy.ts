export function mayPersistQuery(queryKey: readonly unknown[], meta?: Readonly<Record<string, unknown>>): boolean {
  if (meta?.persist === false) return false;
  if (queryKey[0] === "staff") return false;
  const key = JSON.stringify(queryKey).toLowerCase();
  return !key.includes("auth") && !key.includes("session") && !key.includes("token");
}
