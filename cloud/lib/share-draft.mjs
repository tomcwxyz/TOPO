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
export const getDraft = () => operation("readonly", (store) => store.get("latest"));
export const saveDraft = (value) => operation("readwrite", (store) => store.put(value, "latest"));
export const clearDraft = () => operation("readwrite", (store) => store.delete("latest"));
