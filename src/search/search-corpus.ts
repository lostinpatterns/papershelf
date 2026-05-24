import type { PapershelfConfig } from '../config.js';
import type { SearchResult } from '../types.js';
import type { EmbedRequest, EmbedResponse } from '../providers/zeroentropy.js';
import type { VectorStore } from '../storage/pglite-store.js';
import { applyReranker, type Reranker } from './rerank.js';
import { vectorSearch } from './vector-search.js';

export type QueryEmbedder = {
  embed(request: EmbedRequest): Promise<EmbedResponse>;
};

export type SearchProvider = QueryEmbedder & Reranker;

export type SearchCorpusOptions = {
  question: string;
  config: PapershelfConfig;
  provider: SearchProvider;
  store: VectorStore;
};

export async function searchCorpus(options: SearchCorpusOptions): Promise<readonly SearchResult[]> {
  const query = options.question.trim();

  if (query.length === 0) {
    throw new Error('Search question must not be empty.');
  }

  const queryEmbedding = await embedQuery(options, query);
  const candidates = await vectorSearch({
    store: options.store,
    queryEmbedding,
    limit: options.config.defaultCandidateLimit,
  });

  return await applyReranker({
    client: options.provider,
    rerankModel: options.config.rerankModel,
    query,
    candidates,
    candidateLimit: options.config.defaultCandidateLimit,
    resultLimit: options.config.defaultResultLimit,
  });
}

async function embedQuery(options: SearchCorpusOptions, query: string): Promise<readonly number[]> {
  const response = await options.provider.embed({
    model: options.config.embeddingModel,
    input: [query],
    inputType: 'query',
  });

  if (response.embeddings.length !== 1) {
    throw new Error(`Query embedding count mismatch: expected 1, received ${response.embeddings.length}.`);
  }

  const embedding = response.embeddings[0];

  if (embedding === undefined) {
    throw new Error('Query embedding response did not include an embedding.');
  }

  return embedding;
}
