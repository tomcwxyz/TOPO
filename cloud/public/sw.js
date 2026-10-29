/* Installed-PWA share handler. Draft stays in IndexedDB until explicit user submission. */
const DB = "topo-mobile-share-v1", STORE = "drafts";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
function save(value) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, "latest");
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/share-target") return;
  event.respondWith((async () => {
    try {
      const form = await event.request.formData();
      const text = String(form.get("text") || "").slice(0, 24000);
      const title = String(form.get("title") || "").slice(0, 180);
      const sourceUrl = String(form.get("url") || "").slice(0, 2048);
      await save({ title, text, sourceUrl, createdAt: Date.now(), idempotencyKey: crypto.randomUUID() });
      return Response.redirect(new URL("/capture?shared=1", self.location.origin).href, 303);
    } catch {
      return new Response("Unable to stage this share. Open TOPO and paste it manually.", { status: 400 });
    }
  })());
});
