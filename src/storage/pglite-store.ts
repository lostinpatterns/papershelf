import { mkdir } from 'node:fs/promises';
import { PGlite, type PGliteInterface, type Transaction } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import type { ChunkMetadata, EmbeddedChunk, IndexedDocument, PapershelfPaths, SearchCandidate } from '../types.js';
import { acquireStorageLock, releaseStorageLock, type StorageLockHandle } from './lock.js';
import { buildSchemaSql, buildVectorIndexSql } from './schema.js';

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
  listDocuments(): Promise<readonly IndexedDocument[]>;
  deleteDocument(docId: string): Promise<void>;
  upsertDocument(document: IndexedDocument, chunks: readonly EmbeddedChunk[]): Promise<void>;
  search(options: VectorSearchOptions): Promise<readonly SearchCandidate[]>;
  close(): Promise<void>;
};

type DocumentRow = {
  doc_id: string;
  content_hash: string;
  chunker_version: number;
  embedding_model: string;
  embedding_dimensions: number;
  indexed_at: Date | string;
};

type SearchRow = {
  doc_id: string;
  chunk_index: number;
  chunk_text: string;
  metadata: unknown;
  distance: number;
};

export async function openVectorStore(options: OpenVectorStoreOptions): Promise<VectorStore> {
  validateEmbeddingDimensions(options.embeddingDimensions);
  await mkdir(options.paths.indexDir, { recursive: true });

  const lock = await acquireStorageLock({ dataDir: options.paths.indexDir });

  try {
    const db: PGliteInterface = await PGlite.create(options.paths.indexDir, { extensions: { vector } });
    return new PGliteVectorStore(db, lock, options.embeddingDimensions);
  } catch (error) {
    await releaseStorageLock(lock);
    throw error;
  }
}

class PGliteVectorStore implements VectorStore {
  private closed: boolean = false;
  private readonly db: PGliteInterface;
  private readonly lock: StorageLockHandle;
  private readonly embeddingDimensions: number;

  public constructor(db: PGliteInterface, lock: StorageLockHandle, embeddingDimensions: number) {
    this.db = db;
    this.lock = lock;
    this.embeddingDimensions = embeddingDimensions;
  }

  public async initialize(): Promise<void> {
    this.ensureOpen();
    await this.db.exec(buildSchemaSql({ embeddingDimensions: this.embeddingDimensions }));
    await this.db.exec(buildVectorIndexSql());
  }

  public async listDocuments(): Promise<readonly IndexedDocument[]> {
    this.ensureOpen();

    const result = await this.db.query<DocumentRow>(
      `SELECT doc_id, content_hash, chunker_version, embedding_model, embedding_dimensions, indexed_at
       FROM documents
       ORDER BY doc_id`,
    );

    return result.rows.map(documentFromRow);
  }

  public async deleteDocument(docId: string): Promise<void> {
    this.ensureOpen();

    await this.db.transaction(async (tx) => {
      await tx.query('DELETE FROM chunks WHERE doc_id = $1', [docId]);
      await tx.query('DELETE FROM documents WHERE doc_id = $1', [docId]);
    });
  }

  public async upsertDocument(document: IndexedDocument, chunks: readonly EmbeddedChunk[]): Promise<void> {
    this.ensureOpen();
    this.validateDocument(document);
    this.validateChunks(document.docId, chunks);

    await this.db.transaction(async (tx) => {
      await upsertDocumentRow(tx, document);
      await tx.query('DELETE FROM chunks WHERE doc_id = $1', [document.docId]);

      for (const chunk of chunks) {
        await tx.query(
          `INSERT INTO chunks (doc_id, chunk_index, chunk_text, embedding, metadata)
           VALUES ($1, $2, $3, $4::vector, $5::jsonb)`,
          [
            chunk.docId,
            chunk.chunkIndex,
            chunk.text,
            serializeEmbedding(chunk.embedding, this.embeddingDimensions),
            serializeMetadata(chunk.metadata),
          ],
        );
      }
    });
  }

  public async search(options: VectorSearchOptions): Promise<readonly SearchCandidate[]> {
    this.ensureOpen();
    validateSearchLimit(options.limit);

    if (options.limit === 0) {
      return [];
    }

    const result = await this.db.query<SearchRow>(
      `SELECT doc_id, chunk_index, chunk_text, metadata, embedding <=> $1::vector AS distance
       FROM chunks
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [serializeEmbedding(options.embedding, this.embeddingDimensions), options.limit],
    );

    return result.rows.map(searchCandidateFromRow);
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    try {
      if (!this.db.closed) {
        await this.db.close();
      }
    } finally {
      await releaseStorageLock(this.lock);
    }
  }

  private ensureOpen(): void {
    if (this.closed || this.db.closed) {
      throw new Error('Vector store is closed.');
    }
  }

  private validateDocument(document: IndexedDocument): void {
    if (document.embeddingDimensions !== this.embeddingDimensions) {
      throw new Error(
        `Document embedding dimension mismatch for ${document.docId}: expected ${this.embeddingDimensions}, received ${document.embeddingDimensions}.`,
      );
    }
  }

  private validateChunks(docId: string, chunks: readonly EmbeddedChunk[]): void {
    const seenChunkIndexes = new Set<number>();

    for (const chunk of chunks) {
      if (chunk.docId !== docId) {
        throw new Error(`Chunk docId mismatch: expected ${docId}, received ${chunk.docId}.`);
      }

      if (!Number.isInteger(chunk.chunkIndex) || chunk.chunkIndex < 0) {
        throw new Error(`Invalid chunk index for ${docId}: ${chunk.chunkIndex}.`);
      }

      if (seenChunkIndexes.has(chunk.chunkIndex)) {
        throw new Error(`Duplicate chunk index for ${docId}: ${chunk.chunkIndex}.`);
      }

      seenChunkIndexes.add(chunk.chunkIndex);
      serializeEmbedding(chunk.embedding, this.embeddingDimensions);
    }
  }
}

async function upsertDocumentRow(tx: Transaction, document: IndexedDocument): Promise<void> {
  await tx.query(
    `INSERT INTO documents (
       doc_id,
       content_hash,
       chunker_version,
       embedding_model,
       embedding_dimensions,
       indexed_at
     ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
     ON CONFLICT (doc_id) DO UPDATE SET
       content_hash = EXCLUDED.content_hash,
       chunker_version = EXCLUDED.chunker_version,
       embedding_model = EXCLUDED.embedding_model,
       embedding_dimensions = EXCLUDED.embedding_dimensions,
       indexed_at = EXCLUDED.indexed_at`,
    [
      document.docId,
      document.contentHash,
      document.chunkerVersion,
      document.embeddingModel,
      document.embeddingDimensions,
      document.indexedAt.toISOString(),
    ],
  );
}

function documentFromRow(row: DocumentRow): IndexedDocument {
  return {
    docId: row.doc_id,
    contentHash: row.content_hash,
    chunkerVersion: row.chunker_version,
    embeddingModel: row.embedding_model,
    embeddingDimensions: row.embedding_dimensions,
    indexedAt: parseIndexedAt(row.indexed_at),
  };
}

function searchCandidateFromRow(row: SearchRow): SearchCandidate {
  const candidate: SearchCandidate = {
    docId: row.doc_id,
    chunkIndex: row.chunk_index,
    text: row.chunk_text,
    distance: row.distance,
  };
  const metadata = parseMetadata(row.metadata);

  if (hasMetadata(metadata)) {
    candidate.metadata = metadata;
  }

  return candidate;
}

function parseIndexedAt(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid indexed_at value in vector store: ${value}`);
  }

  return date;
}

function serializeEmbedding(embedding: readonly number[], expectedDimensions: number): string {
  if (embedding.length !== expectedDimensions) {
    throw new Error(`Embedding dimension mismatch: expected ${expectedDimensions}, received ${embedding.length}.`);
  }

  if (!embedding.every(Number.isFinite)) {
    throw new Error('Embedding must contain only finite numbers.');
  }

  return `[${embedding.join(',')}]`;
}

function serializeMetadata(metadata: ChunkMetadata | undefined): string {
  return JSON.stringify(metadata ?? {});
}

function parseMetadata(value: unknown): ChunkMetadata {
  const rawMetadata = typeof value === 'string' ? parseJsonMetadata(value) : value;

  if (!isRecord(rawMetadata)) {
    return {};
  }

  const metadata: ChunkMetadata = {};
  const heading = readOptionalString(rawMetadata, 'heading');
  const section = readOptionalString(rawMetadata, 'section');
  const page = readOptionalInteger(rawMetadata, 'page');
  const startLine = readOptionalInteger(rawMetadata, 'startLine');
  const endLine = readOptionalInteger(rawMetadata, 'endLine');

  if (heading !== undefined) {
    metadata.heading = heading;
  }

  if (section !== undefined) {
    metadata.section = section;
  }

  if (page !== undefined) {
    metadata.page = page;
  }

  if (startLine !== undefined) {
    metadata.startLine = startLine;
  }

  if (endLine !== undefined) {
    metadata.endLine = endLine;
  }

  return metadata;
}

function parseJsonMetadata(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readOptionalInteger(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function hasMetadata(metadata: ChunkMetadata): boolean {
  return (
    metadata.heading !== undefined ||
    metadata.section !== undefined ||
    metadata.page !== undefined ||
    metadata.startLine !== undefined ||
    metadata.endLine !== undefined
  );
}

function validateEmbeddingDimensions(embeddingDimensions: number): void {
  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions <= 0) {
    throw new Error('Embedding dimensions must be a positive integer.');
  }
}

function validateSearchLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error('Vector search limit must be a non-negative integer.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
