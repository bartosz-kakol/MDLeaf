export type StorageErrorCode = 'NOT_FOUND' | 'EXISTS' | 'QUOTA' | 'INVALID_PATH' | 'INVALID_ARCHIVE' | 'PERMISSION' | 'LOCKED' | 'IO';

/**
 * Typed storage error. Comlink preserves `name` and `message` only, so the
 * code is encoded into the message as "[CODE] text" and parsed back on the
 * UI side (`parseStorageError`).
 */
export class StorageError extends Error {
  code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = 'StorageError';
    this.code = code;
  }
  /** The message without the code prefix. */
  get text(): string {
    return this.message.replace(/^\[[A-Z_]+\]\s*/, '');
  }
}

export function parseStorageError(err: unknown): StorageError {
  if (err instanceof StorageError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const m = /^\[([A-Z_]+)\]\s*([\s\S]*)$/.exec(message);
  if (m) return new StorageError(m[1] as StorageErrorCode, m[2]);
  if (err instanceof Error && (err.name === 'QuotaExceededError' || /quota/i.test(message))) {
    return new StorageError('QUOTA', 'Storage is full.');
  }
  return new StorageError('IO', message);
}

/** Converts DOM exceptions raised by OPFS into StorageErrors. */
export function toStorageError(err: unknown, context: string): StorageError {
  if (err instanceof StorageError) return err;
  const e = err as { name?: string; message?: string };
  if (e?.name === 'NotFoundError') return new StorageError('NOT_FOUND', `${context}: not found`);
  if (e?.name === 'QuotaExceededError') return new StorageError('QUOTA', 'Storage is full.');
  if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return new StorageError('PERMISSION', `${context}: permission denied`);
  if (e?.name === 'NoModificationAllowedError') return new StorageError('LOCKED', `${context}: the file is locked`);
  return new StorageError('IO', `${context}: ${e?.message ?? String(err)}`);
}
