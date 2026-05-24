import { notImplemented } from '../errors.js';

export type StorageLockHandle = {
  lockDir: string;
  acquired: boolean;
};

export type AcquireStorageLockOptions = {
  dataDir: string;
  timeoutMs?: number;
};

export async function acquireStorageLock(options: AcquireStorageLockOptions): Promise<StorageLockHandle> {
  void options;
  return notImplemented('PGlite storage lock acquisition');
}

export async function releaseStorageLock(lock: StorageLockHandle): Promise<void> {
  void lock;
  return notImplemented('PGlite storage lock release');
}
