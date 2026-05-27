import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageVersion, runCli, usage } from './cli.js';

describe('runCli', () => {
  it('prints usage without a command', async () => {
    await expect(runCli([])).resolves.toEqual({ stdout: usage, exitCode: 0 });
  });

  it('prints usage for help command and flags', async () => {
    await expect(runCli(['help'])).resolves.toEqual({ stdout: usage, exitCode: 0 });
    await expect(runCli(['--help'])).resolves.toEqual({ stdout: usage, exitCode: 0 });
    await expect(runCli(['-h'])).resolves.toEqual({ stdout: usage, exitCode: 0 });
  });

  it('prints the package version for version flags', async () => {
    await expect(runCli(['--version'])).resolves.toEqual({ stdout: packageVersion, exitCode: 0 });
    await expect(runCli(['-v'])).resolves.toEqual({ stdout: packageVersion, exitCode: 0 });
  });

  it('initializes the docs directory and installs the bundled skill', async () => {
    const cwd = await createTemporaryDirectory();

    try {
      await expect(runCli(['init'], { cwd, env: {} })).resolves.toEqual({
        stdout:
          'Initialized papershelf.\n' +
          'Docs directory: .papershelf/docs (created)\n' +
          'Agent skill: .agents/skills/papershelf/SKILL.md (created)',
        exitCode: 0,
      });

      const docsStats = await stat(path.join(cwd, '.papershelf', 'docs'));
      expect(docsStats.isDirectory()).toBe(true);
      await expect(readInstalledSkill(cwd)).resolves.toBe(await readBundledSkill());

      await expect(runCli(['init'], { cwd, env: {} })).resolves.toEqual({
        stdout:
          'Initialized papershelf.\n' +
          'Docs directory: .papershelf/docs (exists)\n' +
          'Agent skill: .agents/skills/papershelf/SKILL.md (unchanged)',
        exitCode: 0,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('refreshes an existing installed skill', async () => {
    const cwd = await createTemporaryDirectory();
    const installedSkillPath = path.join(cwd, '.agents', 'skills', 'papershelf', 'SKILL.md');

    try {
      await mkdir(path.join(cwd, '.papershelf', 'docs'), { recursive: true });
      await mkdir(path.dirname(installedSkillPath), { recursive: true });
      await writeFile(installedSkillPath, 'stale skill\n', 'utf8');

      await expect(runCli(['init'], { cwd, env: {} })).resolves.toEqual({
        stdout:
          'Initialized papershelf.\n' +
          'Docs directory: .papershelf/docs (exists)\n' +
          'Agent skill: .agents/skills/papershelf/SKILL.md (refreshed)',
        exitCode: 0,
      });

      await expect(readInstalledSkill(cwd)).resolves.toBe(await readBundledSkill());
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('accepts index --rebuild and requires ZEROENTROPY_API_KEY before rebuilding', async () => {
    const cwd = await createTemporaryDirectory();

    try {
      await expect(runCli(['index', '--rebuild'], { cwd, env: {} })).resolves.toEqual({
        stderr: 'Missing ZEROENTROPY_API_KEY environment variable. Set it before running index or search.',
        exitCode: 1,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('requires ZEROENTROPY_API_KEY for indexing', async () => {
    const cwd = await createTemporaryDirectory();

    try {
      await expect(runCli(['index'], { cwd, env: {} })).resolves.toEqual({
        stderr: 'Missing ZEROENTROPY_API_KEY environment variable. Set it before running index or search.',
        exitCode: 1,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('requires a search question', async () => {
    await expect(runCli(['search'])).resolves.toEqual({
      stderr: `Missing search question.\n${usage}`,
      exitCode: 1,
    });
  });

  it('requires ZEROENTROPY_API_KEY for search', async () => {
    const cwd = await createTemporaryDirectory();

    try {
      await expect(runCli(['search', 'how does this work?', '--json'], { cwd, env: {} })).resolves.toEqual({
        stderr: 'Missing ZEROENTROPY_API_KEY environment variable. Set it before running index or search.',
        exitCode: 1,
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('reports unknown commands', async () => {
    await expect(runCli(['nope'])).resolves.toEqual({
      stderr: `Unknown command: nope\n${usage}`,
      exitCode: 1,
    });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'papershelf-cli-'));
}

async function readBundledSkill(): Promise<string> {
  return await readFile(new URL('../skills/papershelf/SKILL.md', import.meta.url), 'utf8');
}

async function readInstalledSkill(cwd: string): Promise<string> {
  return await readFile(path.join(cwd, '.agents', 'skills', 'papershelf', 'SKILL.md'), 'utf8');
}
