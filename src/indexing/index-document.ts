import type { EmbeddedChunk, IndexedDocument, SourceDocument } from '../types.js';
import type { ZeroEntropyClient } from '../providers/zeroentropy.js';
import type { VectorStore } from '../storage/pglite-store.js';
import type { ChunkerOptions } from '../chunkers/text-boundaries.js';
import { notImplemented } from '../errors.js';

export type IndexDocumentOptions = {
  document: SourceDocument;
  chunkerOptions: ChunkerOptions;
  chunkerVersion: number;
  embeddingModel: string;
  embedder: ZeroEntropyClient;
  store: VectorStore;
};

export type IndexDocumentResult = {
  document: IndexedDocument;
  chunks: readonly EmbeddedChunk[];
};

export async function indexDocument(options: IndexDocumentOptions): Promise<IndexDocumentResult> {
  void options;
  return notImplemented('single document indexing');
}
