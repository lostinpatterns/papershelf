import type { SearchCandidate } from '../types.js';
import type { VectorStore } from '../storage/pglite-store.js';
import { notImplemented } from '../errors.js';

export type VectorSearchRequest = {
  store: VectorStore;
  queryEmbedding: readonly number[];
  limit: number;
};

export async function vectorSearch(request: VectorSearchRequest): Promise<readonly SearchCandidate[]> {
  void request;
  return notImplemented('vector search');
}
