#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { runIndexCommand } from './commands/index.js';
import { runInitCommand } from './commands/init.js';
import { runSearchCommand } from './commands/search.js';
import { formatError } from './errors.js';
import type { CliResult, CommandContext, SearchOutputFormat } from './types.js';

export const usage: string = `Usage:
  papershelf init
  papershelf index
  papershelf search "<question>" [--json]
`;

export function createCommandContext(): CommandContext {
  return {
    cwd: process.cwd(),
    env: process.env,
  };
}

export async function runCli(
  argv: readonly string[],
  context: CommandContext = createCommandContext(),
): Promise<CliResult> {
  let parsed: ReturnType<typeof parseArgs>;

  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
      },
    });
  } catch (error: unknown) {
    return { stderr: formatError(error), exitCode: 1 };
  }

  const { values, positionals } = parsed;

  if (values['help'] || positionals.length === 0) {
    return { stdout: usage, exitCode: 0 };
  }

  const command = positionals[0];

  if (command === undefined) {
    return { stdout: usage, exitCode: 0 };
  }

  const args = positionals.slice(1);

  try {
    switch (command) {
      case 'init':
        return await runInitCommand({ context });

      case 'index':
        return await runIndexCommand({ context });

      case 'search': {
        const question = args.join(' ').trim();

        if (question.length === 0) {
          return { stderr: `Missing search question.\n${usage}`, exitCode: 1 };
        }

        const format: SearchOutputFormat = values['json'] ? 'json' : 'text';
        return await runSearchCommand({ context, question, format });
      }

      default:
        return { stderr: `Unknown command: ${command}\n${usage}`, exitCode: 1 };
    }
  } catch (error: unknown) {
    return { stderr: formatError(error), exitCode: 1 };
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

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const result = await runCli(argv);
  printResult(result);

  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
