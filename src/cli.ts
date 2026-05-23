#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const usage: string = `Usage:
  papershelf init
  papershelf index
  papershelf search "<question>" [--json]
`;

export type CliResult = {
  stdout?: string;
  stderr?: string;
  exitCode: number;
};

export function runCli(argv: readonly string[]): CliResult {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      json: { type: 'boolean' },
    },
  });

  if (values.help || positionals.length === 0) {
    return { stdout: usage, exitCode: 0 };
  }

  const command = positionals[0];

  if (command === undefined) {
    return { stdout: usage, exitCode: 0 };
  }

  const args = positionals.slice(1);

  switch (command) {
    case 'init':
      return { stdout: 'TODO: init', exitCode: 0 };

    case 'index':
      return { stdout: 'TODO: index', exitCode: 0 };

    case 'search': {
      const jsonFlag = values.json ? ' --json' : '';
      return { stdout: `TODO: search ${args.join(' ')}${jsonFlag}`, exitCode: 0 };
    }

    default:
      return { stderr: `Unknown command: ${command}\n${usage}`, exitCode: 1 };
  }
}

function printResult(result: CliResult): void {
  if (result.stdout !== undefined) {
    console.log(result.stdout);
  }

  if (result.stderr !== undefined) {
    console.error(result.stderr);
  }
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const result = runCli(argv);
  printResult(result);

  if (result.exitCode !== 0) {
    process.exit(result.exitCode);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
