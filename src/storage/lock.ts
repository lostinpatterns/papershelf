import { mkdir, rm } from 'node:fs/promises';
import * as path from 'node:path';

export type StorageLockHandle = {
  lockDir: string;
};

export type AcquireStorageLockOptions = {
  dataDir: string;
};

export async function acquireStorageLock(options: AcquireStorageLockOptions): Promise<StorageLockHandle> {
  const lockDir = `${path.resolve(options.dataDir)}.lock`;

  await mkdir(path.dirname(lockDir), { recursive: true });

  try {
    await mkdir(lockDir);
    return { lockDir };
  } catch (error) {
    if (isErrnoException(error, 'EEXIST')) {
      throw new Error(`Papershelf index is locked by another process: ${lockDir}`, { cause: error });
    }

    throw error;
  }
}

export async function releaseStorageLock(lock: StorageLockHandle): Promise<void> {
  await rm(lock.lockDir, { recursive: true, force: true });
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}
