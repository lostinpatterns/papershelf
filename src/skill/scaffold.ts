import { mkdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { PapershelfPaths } from '../types.js';

export type ScaffoldSkillOptions = {
  paths: PapershelfPaths;
  force?: boolean;
};

export type ScaffoldSkillResult = {
  installedPath: string;
  status: 'created' | 'refreshed' | 'unchanged' | 'conflict';
};

export async function scaffoldSkill(options: ScaffoldSkillOptions): Promise<ScaffoldSkillResult> {
  const { paths, force = false } = options;
  const bundledSkill = await readFile(paths.bundledSkillPath, 'utf8');
  const installedSkill = await readInstalledSkill(paths.installedSkillPath);

  if (installedSkill === bundledSkill) {
    return { installedPath: paths.installedSkillPath, status: 'unchanged' };
  }

  if (installedSkill !== undefined && !force) {
    return { installedPath: paths.installedSkillPath, status: 'conflict' };
  }

  await mkdir(path.dirname(paths.installedSkillPath), { recursive: true });
  await writeFile(paths.installedSkillPath, bundledSkill, 'utf8');

  return {
    installedPath: paths.installedSkillPath,
    status: installedSkill === undefined ? 'created' : 'refreshed',
  };
}

async function readInstalledSkill(installedSkillPath: string): Promise<string | undefined> {
  try {
    return await readFile(installedSkillPath, 'utf8');
  } catch (error: unknown) {
    if (isFileSystemErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }

    throw error;
  }
}

function isFileSystemErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
