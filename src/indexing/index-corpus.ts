import type { CliResult, CommandContext, PapershelfPaths } from '../types.js';
import type { PapershelfConfig } from '../config.js';
import type { ChunkerOptions } from '../chunkers/text-boundaries.js';
import { notImplemented } from '../errors.js';

export type IndexCorpusOptions = {
  context: CommandContext;
  paths: PapershelfPaths;
  config: PapershelfConfig;
  chunkerOptions: ChunkerOptions;
  chunkerVersion: number;
};

export async function indexCorpus(options: IndexCorpusOptions): Promise<CliResult> {
  void options;
  return notImplemented('corpus indexing pipeline');
}
