import { describe, expect, it } from 'vitest';
import { runCli, usage } from './cli.js';

describe('runCli', () => {
  it('prints usage without a command', () => {
    expect(runCli([])).toEqual({ stdout: usage, exitCode: 0 });
  });

  it('handles the init command', () => {
    expect(runCli(['init'])).toEqual({ stdout: 'TODO: init', exitCode: 0 });
  });

  it('passes search arguments and json flag through', () => {
    expect(runCli(['search', 'how does this work?', '--json'])).toEqual({
      stdout: 'TODO: search how does this work? --json',
      exitCode: 0,
    });
  });

  it('reports unknown commands', () => {
    expect(runCli(['nope'])).toEqual({
      stderr: `Unknown command: nope\n${usage}`,
      exitCode: 1,
    });
  });
});
