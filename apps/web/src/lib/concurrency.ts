// Runs fn over items with at most `limit` calls in flight at once. Used for
// per-item API fan-outs where a plain Promise.all(items.map(...)) would fire
// one withTenant() transaction per item simultaneously — fine when Neon is
// warm, but a burst that size can outrun packages/db's tenant-client.ts
// single-retry budget when Neon's compute is cold (autosuspend), surfacing
// as a page error or, worse, silently-swallowed per-item failures. Root-
// caused 2026-08-04 from a production incident on the class-subjects Matrix
// page; see docs/deferred.md. Capping concurrency keeps warm-path latency
// close to fully-parallel while cutting simultaneous cold-start pool
// pressure from N down to `limit`.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      if (item === undefined) continue;
      results[i] = await fn(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
