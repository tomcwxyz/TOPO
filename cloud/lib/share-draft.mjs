// Browser-only draft storage, also used by /public/sw.js.
const NAME = "topo-mobile-share-v1";
const STORE = "drafts";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function operation(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function getDraft() {
  const draft = await operation("readonly", (store) => store.get("latest"));
  if (draft && (!Number.isFinite(draft.createdAt) || Date.now() - draft.createdAt > 24 * 3600 * 1000)) {
    await clearDraft();
    return null;
  }
  return draft;
}
export const saveDraft = (value) => operation("readwrite", (store) => store.put({ ...value, createdAt: Date.now() }, "latest"));
export const clearDraft = () => operation("readwrite", (store) => store.delete("latest"));
