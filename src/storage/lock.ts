import { mkdir, rm } from 'node:fs/promises';
import * as path from 'node:path';

export type StorageLockHandle = {
  lockDir: string;
  acquired: boolean;
};

export type AcquireStorageLockOptions = {
  dataDir: string;
  timeoutMs?: number;
};

const defaultLockTimeoutMs: number = 10_000;
const lockRetryDelayMs: number = 50;

export async function acquireStorageLock(options: AcquireStorageLockOptions): Promise<StorageLockHandle> {
  const timeoutMs = options.timeoutMs ?? defaultLockTimeoutMs;

  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('Storage lock timeoutMs must be a non-negative finite number.');
  }

  const lockDir = `${path.resolve(options.dataDir)}.lock`;
  const startedAt = Date.now();

  await mkdir(path.dirname(lockDir), { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir);
      return { lockDir, acquired: true };
    } catch (error) {
      if (!isErrnoException(error, 'EEXIST')) {
        throw error;
      }

      const elapsedMs = Date.now() - startedAt;

      if (elapsedMs >= timeoutMs) {
        throw new Error(`Papershelf index is locked by another process: ${lockDir}`, { cause: error });
      }

      await delay(Math.min(lockRetryDelayMs, timeoutMs - elapsedMs));
    }
  }
}

export async function releaseStorageLock(lock: StorageLockHandle): Promise<void> {
  if (!lock.acquired) {
    return;
  }

  await rm(lock.lockDir, { recursive: true, force: true });
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
