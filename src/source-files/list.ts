import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import type { PapershelfPaths, SourceFile, SupportedSourceFileExtension } from '../types.js';
import { toDocumentId } from '../paths.js';

export const supportedSourceFileExtensions: readonly SupportedSourceFileExtension[] = ['.txt', '.md', '.markdown'];

export type ListSourceFilesOptions = {
  paths: PapershelfPaths;
  extensions?: readonly SupportedSourceFileExtension[];
};

export async function listSourceFiles(options: ListSourceFilesOptions): Promise<readonly SourceFile[]> {
  const extensions = new Set<SupportedSourceFileExtension>(options.extensions ?? supportedSourceFileExtensions);
  const files = await collectSourceFiles(options.paths, options.paths.docsDir, extensions);

  return files.sort(compareSourceFilesByDocId);
}

async function collectSourceFiles(
  paths: PapershelfPaths,
  directoryPath: string,
  extensions: ReadonlySet<SupportedSourceFileExtension>,
): Promise<SourceFile[]> {
  let entries: Dirent[];

  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (isFileSystemErrorWithCode(error, 'ENOENT') && directoryPath === paths.docsDir) {
      return [];
    }

    throw error;
  }

  const files: SourceFile[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(paths, absolutePath, extensions)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!isSupportedExtension(path.extname(entry.name), extensions)) {
      continue;
    }

    files.push({
      docId: toDocumentId(paths.repoRoot, absolutePath),
      absolutePath,
    });
  }

  return files;
}

function isSupportedExtension(
  extension: string,
  extensions: ReadonlySet<SupportedSourceFileExtension>,
): extension is SupportedSourceFileExtension {
  return extensions.has(extension.toLowerCase() as SupportedSourceFileExtension);
}

function compareSourceFilesByDocId(left: SourceFile, right: SourceFile): number {
  if (left.docId < right.docId) {
    return -1;
  }

  if (left.docId > right.docId) {
    return 1;
  }

  return 0;
}

function isFileSystemErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
