// SchoolKit Exams — service worker (docs/modules/cbt.md D9).
//
// Keeps the app's OWN files so a lab machine that opened the exam page once,
// online, can open it again with the network down (after a power cut, say).
//   * /_next/static/* is content-hashed, so a cached copy is always right:
//     cache first.
//   * Pages: network first, falling back to the last copy.
// Never the API: exam packs and answers live in IndexedDB, handled by the app.
// Bump CACHE to drop every old copy at the next visit.

const CACHE = "school-kit-cbt-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(CACHE)).put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await caches.match(request, { ignoreVary: true });
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/")) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(networkFirst(request));
  }
});
