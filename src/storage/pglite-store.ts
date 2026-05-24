import type { EmbeddedChunk, IndexedDocument, PapershelfPaths, SearchCandidate } from '../types.js';
import { notImplemented } from '../errors.js';

export type OpenVectorStoreOptions = {
  paths: PapershelfPaths;
  embeddingDimensions: number;
};

export type VectorSearchOptions = {
  embedding: readonly number[];
  limit: number;
};

export type VectorStore = {
  initialize(): Promise<void>;
  getDocument(docId: string): Promise<IndexedDocument | undefined>;
  listDocuments(): Promise<readonly IndexedDocument[]>;
  deleteDocument(docId: string): Promise<void>;
  upsertDocument(document: IndexedDocument, chunks: readonly EmbeddedChunk[]): Promise<void>;
  search(options: VectorSearchOptions): Promise<readonly SearchCandidate[]>;
  close(): Promise<void>;
};

export async function openVectorStore(options: OpenVectorStoreOptions): Promise<VectorStore> {
  void options;
  return notImplemented('vector store opening');
}
