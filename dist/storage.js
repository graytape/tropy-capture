const DB_NAME = "tropy-capture";
const DB_VERSION = 1;
const SESSION_STORE = "sessions";
const ASSET_STORE = "assets";

let dbPromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Operazione annullata"));
  });
}

export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
        sessions.createIndex("updatedAt", "updatedAt");
      }
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        const assets = database.createObjectStore(ASSET_STORE, { keyPath: "id" });
        assets.createIndex("sessionId", "sessionId");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export async function listSessions() {
  const database = await openDatabase();
  const transaction = database.transaction(SESSION_STORE, "readonly");
  const sessions = await requestResult(transaction.objectStore(SESSION_STORE).getAll());
  await transactionDone(transaction);
  return sessions.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getSession(id) {
  const database = await openDatabase();
  const transaction = database.transaction(SESSION_STORE, "readonly");
  const result = await requestResult(transaction.objectStore(SESSION_STORE).get(id));
  await transactionDone(transaction);
  return result || null;
}

export async function saveSession(session) {
  const database = await openDatabase();
  const transaction = database.transaction(SESSION_STORE, "readwrite");
  transaction.objectStore(SESSION_STORE).put(session);
  await transactionDone(transaction);
  return session;
}

export async function saveAsset({ id, sessionId, blob }) {
  const database = await openDatabase();
  const transaction = database.transaction(ASSET_STORE, "readwrite");
  transaction.objectStore(ASSET_STORE).put({ id, sessionId, blob });
  await transactionDone(transaction);
}

export async function saveAssets(records) {
  if (!records.length) return;
  const database = await openDatabase();
  const transaction = database.transaction(ASSET_STORE, "readwrite");
  const store = transaction.objectStore(ASSET_STORE);
  for (const record of records) store.put(record);
  await transactionDone(transaction);
}

export async function getAsset(id) {
  const database = await openDatabase();
  const transaction = database.transaction(ASSET_STORE, "readonly");
  const result = await requestResult(transaction.objectStore(ASSET_STORE).get(id));
  await transactionDone(transaction);
  return result?.blob || null;
}

export async function deleteAsset(id) {
  const database = await openDatabase();
  const transaction = database.transaction(ASSET_STORE, "readwrite");
  transaction.objectStore(ASSET_STORE).delete(id);
  await transactionDone(transaction);
}

export async function deleteSession(id) {
  const database = await openDatabase();
  const transaction = database.transaction([SESSION_STORE, ASSET_STORE], "readwrite");
  transaction.objectStore(SESSION_STORE).delete(id);

  const assets = transaction.objectStore(ASSET_STORE);
  const cursorRequest = assets.index("sessionId").openKeyCursor(IDBKeyRange.only(id));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    assets.delete(cursor.primaryKey);
    cursor.continue();
  };

  await transactionDone(transaction);
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
