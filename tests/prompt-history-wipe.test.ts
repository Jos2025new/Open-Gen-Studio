import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { createStore, get, set } from 'idb-keyval';
import { ALL_DB_NAMES, wipeLocalDatabases } from '../src/lib/idb';

it('el borrado bloqueado por el historial se completa al cerrar la página y al reabrir está vacío', async () => {
  let connection: IDBDatabase | undefined;
  const originalOpen = indexedDB.open.bind(indexedDB);
  const opening = vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
    const request = originalOpen(...args);
    if (args[0] === 'ogs-prompts') request.addEventListener('success', () => { connection = request.result; });
    return request;
  });
  const historyStore = createStore('ogs-prompts', 'kv');
  const history = { recents: ['browser-only prompt'], favorites: [] };
  await set('create', history, historyStore);
  expect(await get('create', historyStore)).toEqual(history);
  expect(connection).toBeDefined();
  const deletion = vi.spyOn(indexedDB, 'deleteDatabase');
  await wipeLocalDatabases();
  expect(ALL_DB_NAMES).toEqual(['ogs-state', 'ogs-blobs', 'ogs-cache', 'ogs-store-v2', 'ogs-prompts']);
  expect(deletion.mock.calls.map(([name]) => name)).toContain('ogs-prompts');
  const pending = deletion.mock.results.find((_, i) => deletion.mock.calls[i][0] === 'ogs-prompts')!.value as IDBOpenDBRequest;
  const deleted = new Promise<void>((resolve, reject) => {
    pending.addEventListener('success', () => resolve());
    pending.addEventListener('error', () => reject(pending.error));
  });
  // The real app reloads; closing its handle here simulates the page unloading.
  connection!.close();
  await deleted;
  const reopened = await new Promise<IDBDatabase>((resolve) => {
    const request = originalOpen('ogs-prompts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
  });
  const saved = await new Promise<unknown>((resolve) => {
    const request = reopened.transaction('kv').objectStore('kv').get('create');
    request.onsuccess = () => resolve(request.result);
  });
  expect(saved).toBeUndefined();
  reopened.close(); opening.mockRestore(); deletion.mockRestore();
});
