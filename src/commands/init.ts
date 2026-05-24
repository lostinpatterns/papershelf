import { mkdir, stat } from 'node:fs/promises';
import type { CliResult, CommandContext, PapershelfPaths } from '../types.js';
import { resolvePapershelfPaths, toRepoRelativePath } from '../paths.js';
import { scaffoldSkill, type ScaffoldSkillResult } from '../skill/scaffold.js';

export type InitCommandOptions = {
  context: CommandContext;
};

type DirectoryStatus = 'created' | 'exists';

export async function runInitCommand(options: InitCommandOptions): Promise<CliResult> {
  const paths = resolvePapershelfPaths(options.context.cwd);
  const docsStatus = await ensureDirectory(paths.docsDir);
  const skillResult = await scaffoldSkill({ paths, force: true });

  return {
    stdout: formatInitOutput(paths, docsStatus, skillResult),
    exitCode: 0,
  };
}

async function ensureDirectory(directoryPath: string): Promise<DirectoryStatus> {
  try {
    const stats = await stat(directoryPath);

    if (!stats.isDirectory()) {
      throw new Error(`${directoryPath} exists and is not a directory`);
    }

    return 'exists';
  } catch (error: unknown) {
    if (!isFileSystemErrorWithCode(error, 'ENOENT')) {
      throw error;
    }
  }

  await mkdir(directoryPath, { recursive: true });
  return 'created';
}

function formatInitOutput(
  paths: PapershelfPaths,
  docsStatus: DirectoryStatus,
  skillResult: ScaffoldSkillResult,
): string {
  const docsPath = toRepoRelativePath(paths.repoRoot, paths.docsDir);
  const skillPath = toRepoRelativePath(paths.repoRoot, skillResult.installedPath);

  return [
    'Initialized papershelf.',
    `Docs directory: ${docsPath} (${docsStatus})`,
    `Agent skill: ${skillPath} (${skillResult.status})`,
  ].join('\n');
}

function isFileSystemErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
