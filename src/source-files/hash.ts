import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SourceFile } from '../types.js';

export async function hashSourceFileBytes(file: SourceFile): Promise<string> {
  const bytes = await readFile(file.absolutePath);
  return createHash('sha256').update(bytes).digest('hex');
}
