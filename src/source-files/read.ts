import { readFile } from 'node:fs/promises';
import type { SourceFile } from '../types.js';

export type ReadSourceFileTextOptions = {
  file: SourceFile;
  encoding?: BufferEncoding;
};

export async function readSourceFileText(options: ReadSourceFileTextOptions): Promise<string> {
  return await readFile(options.file.absolutePath, options.encoding ?? 'utf8');
}
