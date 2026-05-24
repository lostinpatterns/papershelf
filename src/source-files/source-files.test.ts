import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PapershelfPaths, SourceFile } from '../types.js';
import { hashSourceFileBytes } from './hash.js';
import { listSourceFiles } from './list.js';
import { readSourceFileText } from './read.js';

describe('source files', () => {
  it('recursively lists supported text source files with repo-relative doc ids', async () => {
    const repoRoot = await createTemporaryDirectory();
    const paths = createPaths(repoRoot);

    try {
      await mkdir(path.join(paths.docsDir, 'nested', 'deeper'), { recursive: true });
      await writeFile(path.join(paths.docsDir, 'paper.txt'), 'txt', 'utf8');
      await writeFile(path.join(paths.docsDir, 'nested', 'notes.md'), 'md', 'utf8');
      await writeFile(path.join(paths.docsDir, 'nested', 'deeper', 'report.markdown'), 'markdown', 'utf8');
      await writeFile(path.join(paths.docsDir, 'nested', 'ignored.pdf'), 'pdf', 'utf8');
      await writeFile(path.join(paths.docsDir, 'nested', 'ignored'), 'no extension', 'utf8');

      await expect(listSourceFiles({ paths })).resolves.toEqual([
        {
          docId: '.papershelf/docs/nested/deeper/report.markdown',
          absolutePath: path.join(paths.docsDir, 'nested', 'deeper', 'report.markdown'),
        },
        {
          docId: '.papershelf/docs/nested/notes.md',
          absolutePath: path.join(paths.docsDir, 'nested', 'notes.md'),
        },
        {
          docId: '.papershelf/docs/paper.txt',
          absolutePath: path.join(paths.docsDir, 'paper.txt'),
        },
      ]);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('returns an empty corpus when the docs directory is missing', async () => {
    const repoRoot = await createTemporaryDirectory();

    try {
      await expect(listSourceFiles({ paths: createPaths(repoRoot) })).resolves.toEqual([]);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('reads source files as UTF-8 text by default', async () => {
    const repoRoot = await createTemporaryDirectory();
    const paths = createPaths(repoRoot);
    const filePath = path.join(paths.docsDir, 'utf8.txt');
    const file: SourceFile = { docId: '.papershelf/docs/utf8.txt', absolutePath: filePath };

    try {
      await mkdir(paths.docsDir, { recursive: true });
      await writeFile(filePath, 'héllo\n', 'utf8');

      await expect(readSourceFileText({ file })).resolves.toBe('héllo\n');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it('hashes raw source file bytes with SHA-256', async () => {
    const repoRoot = await createTemporaryDirectory();
    const paths = createPaths(repoRoot);
    const filePath = path.join(paths.docsDir, 'bytes.txt');
    const bytes = Buffer.from([0x68, 0xc3, 0xa9, 0x0a]);
    const file: SourceFile = { docId: '.papershelf/docs/bytes.txt', absolutePath: filePath };

    try {
      await mkdir(paths.docsDir, { recursive: true });
      await writeFile(filePath, bytes);

      await expect(hashSourceFileBytes(file)).resolves.toBe(createHash('sha256').update(bytes).digest('hex'));
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

async function createTemporaryDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'papershelf-source-files-'));
}

function createPaths(repoRoot: string): PapershelfPaths {
  const papershelfDir = path.join(repoRoot, '.papershelf');

  return {
    repoRoot,
    papershelfDir,
    docsDir: path.join(papershelfDir, 'docs'),
    indexDir: path.join(papershelfDir, 'index'),
    bundledSkillPath: path.join(repoRoot, 'skills', 'papershelf', 'SKILL.md'),
    installedSkillPath: path.join(repoRoot, '.agents', 'skills', 'papershelf', 'SKILL.md'),
  };
}
