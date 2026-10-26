/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import { createStore, del, get, set } from 'idb-keyval';
import { OpfsStorage } from '../storage/opfsStorage.ts';

const handleStore = createStore('mdleaf', 'handles');
const channel = new BroadcastChannel('mdleaf');

const storage = new OpfsStorage({
  root: () => navigator.storage.getDirectory(),
  handles: {
    get: (docId) => get<FileSystemDirectoryHandle>(`dir:${docId}`, handleStore),
    set: (docId, handle) => set(`dir:${docId}`, handle, handleStore),
    del: (docId) => del(`dir:${docId}`, handleStore),
  },
  language: navigator.language,
  broadcast: (msg) => channel.postMessage(msg),
});

Comlink.expose(storage);
