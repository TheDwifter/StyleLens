import type { CaptureRecord, CaptureSummaryItem } from '../types/capture';

const DB_NAME = 'stylelens_local_db';
const DB_VERSION = 1;
const STORE_NAME = 'captures';
const MAX_STORED_CAPTURES = 25;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB.'));
    };
  });

  return dbPromise;
}

function runTx<T>(
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const req = executor(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB operation failed.'));
      })
  );
}

/**
 * Ensures captures persisted by older StyleLens versions migrate missing fields cleanly.
 */
function normalizeCaptureRecord(record: CaptureRecord): CaptureRecord {
  const surfaces = record.dna?.surfaces;
  return {
    ...record,
    roots: Array.isArray(record.roots) ? record.roots : [],
    dna: {
      ...record.dna,
      palette: Array.isArray(record.dna?.palette) ? record.dna.palette : [],
      typography: Array.isArray(record.dna?.typography) ? record.dna.typography : [],
      contrastChecks: Array.isArray(record.dna?.contrastChecks) ? record.dna.contrastChecks : [],
      traits: Array.isArray(record.dna?.traits) ? record.dna.traits : [],
      cssVariables: Array.isArray(record.dna?.cssVariables) ? record.dna.cssVariables : [],
      fontStylesheetUrls: Array.isArray(record.dna?.fontStylesheetUrls)
        ? record.dna.fontStylesheetUrls
        : [],
      fontFaceRules: Array.isArray(record.dna?.fontFaceRules) ? record.dna.fontFaceRules : [],
      pageFallbackTypography: Array.isArray(record.dna?.pageFallbackTypography)
        ? record.dna.pageFallbackTypography
        : [],
      surfaces: {
        borderRadii: Array.isArray(surfaces?.borderRadii) ? surfaces.borderRadii : [],
        borders: Array.isArray(surfaces?.borders) ? surfaces.borders : [],
        shadows: Array.isArray(surfaces?.shadows) ? surfaces.shadows : [],
        textShadows: Array.isArray(surfaces?.textShadows) ? surfaces.textShadows : [],
        transforms: Array.isArray(surfaces?.transforms) ? surfaces.transforms : [],
        clipPaths: Array.isArray(surfaces?.clipPaths) ? surfaces.clipPaths : [],
        gradients: Array.isArray(surfaces?.gradients) ? surfaces.gradients : [],
        backdropFilters: Array.isArray(surfaces?.backdropFilters) ? surfaces.backdropFilters : [],
      },
    },
  };
}

export async function saveCapture(record: CaptureRecord): Promise<void> {
  await runTx('readwrite', (store) => store.put(normalizeCaptureRecord(record)));
  await pruneOldCaptures();
}

export async function getCaptureById(id: string): Promise<CaptureRecord | null> {
  const result = await runTx<CaptureRecord | undefined>('readonly', (store) => store.get(id));
  return result ? normalizeCaptureRecord(result) : null;
}

export async function listCaptureSummaries(): Promise<CaptureSummaryItem[]> {
  const all = await runTx<CaptureRecord[]>('readonly', (store) => store.getAll());
  return all
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((record) => ({
      id: record.id,
      createdAt: record.createdAt,
      hostname: record.page.hostname,
      title: record.page.title,
      width: record.rect.width,
      height: record.rect.height,
      captureMode: record.captureMode,
      topColors: record.dna.palette.slice(0, 4).map((c) => c.hex),
    }));
}

export async function deleteCapture(id: string): Promise<void> {
  await runTx('readwrite', (store) => store.delete(id));
}

export async function clearAllCaptures(): Promise<void> {
  await runTx('readwrite', (store) => store.clear());
}

async function pruneOldCaptures(): Promise<void> {
  const all = await runTx<CaptureRecord[]>('readonly', (store) => store.getAll());
  if (all.length <= MAX_STORED_CAPTURES) return;

  const sorted = all.sort((a, b) => b.createdAt - a.createdAt);
  const stale = sorted.slice(MAX_STORED_CAPTURES);

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const item of stale) {
      store.delete(item.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to prune old captures.'));
  });
}
