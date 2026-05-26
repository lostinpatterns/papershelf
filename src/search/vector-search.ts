import type { SearchCandidate } from '../types.js';
import type { VectorStore } from '../storage/libsql-store.js';

export type VectorSearchRequest = {
  store: VectorStore;
  queryEmbedding: readonly number[];
  limit: number;
};

export async function vectorSearch(request: VectorSearchRequest): Promise<readonly SearchCandidate[]> {
  return await request.store.search({
    embedding: request.queryEmbedding,
    limit: request.limit,
  });
}
