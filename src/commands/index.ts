import type { CliResult, CommandContext } from '../types.js';
import { notImplemented } from '../errors.js';

export type IndexCommandOptions = {
  context: CommandContext;
};

export async function runIndexCommand(options: IndexCommandOptions): Promise<CliResult> {
  void options;
  return notImplemented('index command');
}
