import type { PapershelfConfig } from '../config.js';
import type { PapershelfPaths, SearchOutputFormat, SearchResult } from '../types.js';
import type { ZeroEntropyClient } from '../providers/zeroentropy.js';
import type { VectorStore } from '../storage/pglite-store.js';
import { notImplemented } from '../errors.js';

export type SearchCorpusOptions = {
  question: string;
  format: SearchOutputFormat;
  paths: PapershelfPaths;
  config: PapershelfConfig;
  provider: ZeroEntropyClient;
  store: VectorStore;
};

export async function searchCorpus(options: SearchCorpusOptions): Promise<readonly SearchResult[]> {
  void options;
  return notImplemented('corpus search pipeline');
}
