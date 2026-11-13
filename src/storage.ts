import { parseStudyDocument } from "./model";
import type { StudyDocument } from "./model";
const DATABASE = "sld-power-flow-v1";
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("workspace");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("workspace", mode);
    const req = run(tx.objectStore("workspace"));
    let value: T;
    req.onsuccess = () => {
      value = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("Local storage transaction aborted."));
    };
  });
}
export async function saveOpenCase(doc: StudyDocument) {
  await transact("readwrite", (s) => s.put(JSON.stringify(doc), "open-case"));
}
export async function loadOpenCase(): Promise<StudyDocument | null> {
  const text = await transact("readonly", (s) => s.get("open-case"));
  return typeof text === "string" ? parseStudyDocument(text) : null;
}
export async function storeBlob(key: string, blob: Blob) {
  await transact("readwrite", (s) => s.put(blob, `blob:${key}`));
}
export async function loadBlob(key: string): Promise<Blob | null> {
  const result = await transact("readonly", (s) => s.get(`blob:${key}`));
  return result instanceof Blob ? result : null;
}
export async function clearWorkspace() {
  await transact("readwrite", (s) => s.clear());
}
