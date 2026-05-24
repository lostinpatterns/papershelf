import type { CliResult, CommandContext, SearchOutputFormat } from '../types.js';
import { notImplemented } from '../errors.js';

export type SearchCommandOptions = {
  context: CommandContext;
  question: string;
  format: SearchOutputFormat;
};

export async function runSearchCommand(options: SearchCommandOptions): Promise<CliResult> {
  void options;
  return notImplemented('search command');
}
