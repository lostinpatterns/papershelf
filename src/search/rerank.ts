import type { RerankResult, SearchCandidate, SearchResult } from '../types.js';
import type { ZeroEntropyClient } from '../providers/zeroentropy.js';
import { notImplemented } from '../errors.js';

export type ApplyRerankerOptions = {
  client: ZeroEntropyClient;
  query: string;
  candidates: readonly SearchCandidate[];
  candidateLimit: number;
  resultLimit: number;
};

export type RerankerOrdering = {
  results: readonly RerankResult[];
  failedOpen: boolean;
};

export async function applyReranker(options: ApplyRerankerOptions): Promise<readonly SearchResult[]> {
  void options;
  return notImplemented('fail-open reranking');
}
