import * as Comlink from 'comlink';
import type { ImageWorkerApi } from '../workers/image.worker.ts';

const IDLE_MS = 60_000;
let worker: Worker | null = null;
let api: Comlink.Remote<ImageWorkerApi> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function touch(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    worker?.terminate();
    worker = null;
    api = null;
  }, IDLE_MS);
}

/** The image worker is created lazily and terminated after 60 s idle. */
export function imageWorker(): Comlink.Remote<ImageWorkerApi> {
  if (!api) {
    worker = new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module', name: 'mdleaf-image' });
    api = Comlink.wrap<ImageWorkerApi>(worker);
  }
  touch();
  return api;
}
