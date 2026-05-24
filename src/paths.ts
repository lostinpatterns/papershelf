import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PapershelfPaths } from './types.js';

export function resolvePapershelfPaths(cwd: string): PapershelfPaths {
  const repoRoot = findRepoRoot(cwd);
  const papershelfDir = path.join(repoRoot, '.papershelf');
  const bundledSkillPath = fileURLToPath(new URL('../skills/papershelf/SKILL.md', import.meta.url));

  return {
    repoRoot,
    papershelfDir,
    docsDir: path.join(papershelfDir, 'docs'),
    indexDir: path.join(papershelfDir, 'index'),
    bundledSkillPath,
    installedSkillPath: path.join(repoRoot, '.agents', 'skills', 'papershelf', 'SKILL.md'),
  };
}

export function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  const relativePath = path.relative(path.resolve(repoRoot), path.resolve(absolutePath));

  if (relativePath.length === 0) {
    return '.';
  }

  return relativePath.split(path.sep).join('/');
}

export function toDocumentId(repoRoot: string, absolutePath: string): string {
  return toRepoRelativePath(repoRoot, absolutePath);
}

function findRepoRoot(cwd: string): string {
  const start = path.resolve(cwd);
  let current = start;

  while (true) {
    if (existsSync(path.join(current, '.git'))) {
      return current;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      return start;
    }

    current = parent;
  }
}
