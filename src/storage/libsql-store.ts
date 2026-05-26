import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient, type Client, type Row, type Transaction, type Value } from '@libsql/client';
import type { ChunkMetadata, EmbeddedChunk, IndexedDocument, PapershelfPaths, SearchCandidate } from '../types.js';
import { acquireStorageLock, releaseStorageLock, type StorageLockHandle } from './lock.js';
import {
  currentStorageSchemaVersion,
  storageSchemaVersionFileName,
  buildSchemaSql,
  buildVectorIndexSql,
  chunksEmbeddingDiskAnnIndexName,
} from './schema.js';

export type OpenVectorStoreOptions = {
  paths: PapershelfPaths;
  embeddingDimensions: number;
  rebuild?: boolean;
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

const databaseFileName = 'papershelf.db';

export async function openVectorStore(options: OpenVectorStoreOptions): Promise<VectorStore> {
  validateEmbeddingDimensions(options.embeddingDimensions);

  const lock = await acquireStorageLock({ dataDir: options.paths.indexDir });
  let db: Client | undefined;

  try {
    if (options.rebuild === true) {
      await rm(options.paths.indexDir, { recursive: true, force: true });
    }

    await mkdir(options.paths.indexDir, { recursive: true });
    await assertStorageSchemaVersion(options.paths.indexDir);

    db = createClient({ url: pathToFileURL(databaseFilePath(options.paths.indexDir)).href });
    await db.execute('PRAGMA foreign_keys = ON');

    return new LibsqlVectorStore(db, lock, options.embeddingDimensions, options.paths.indexDir);
  } catch (error) {
    db?.close();
    await releaseStorageLock(lock);
    throw error;
  }
}

class LibsqlVectorStore implements VectorStore {
  private closed: boolean = false;
  private readonly db: Client;
  private readonly lock: StorageLockHandle;
  private readonly embeddingDimensions: number;
  private readonly indexDir: string;

  public constructor(db: Client, lock: StorageLockHandle, embeddingDimensions: number, indexDir: string) {
    this.db = db;
    this.lock = lock;
    this.embeddingDimensions = embeddingDimensions;
    this.indexDir = indexDir;
  }

  public async initialize(): Promise<void> {
    this.ensureOpen();
    await this.db.executeMultiple(buildSchemaSql({ embeddingDimensions: this.embeddingDimensions }));
    await this.db.execute(buildVectorIndexSql());
    await writeStorageSchemaVersion(this.indexDir);
  }

  public async listDocuments(): Promise<readonly IndexedDocument[]> {
    this.ensureOpen();

    const result = await this.db.execute(
      `SELECT doc_id, content_hash, chunker_version, embedding_model, embedding_dimensions, indexed_at
       FROM documents
       ORDER BY doc_id`,
    );

    return result.rows.map(documentFromRow);
  }

  public async deleteDocument(docId: string): Promise<void> {
    this.ensureOpen();

    await withWriteTransaction(this.db, async (tx) => {
      await tx.execute({ sql: 'DELETE FROM chunks WHERE doc_id = ?', args: [docId] });
      await tx.execute({ sql: 'DELETE FROM documents WHERE doc_id = ?', args: [docId] });
    });
  }

  public async upsertDocument(document: IndexedDocument, chunks: readonly EmbeddedChunk[]): Promise<void> {
    this.ensureOpen();
    this.validateDocument(document);
    this.validateChunks(document.docId, chunks);

    await withWriteTransaction(this.db, async (tx) => {
      await upsertDocumentRow(tx, document);
      await tx.execute({ sql: 'DELETE FROM chunks WHERE doc_id = ?', args: [document.docId] });

      for (const chunk of chunks) {
        await tx.execute({
          sql: `INSERT INTO chunks (doc_id, chunk_index, chunk_text, embedding, metadata)
                VALUES (?, ?, ?, vector32(?), json(?))`,
          args: [
            chunk.docId,
            chunk.chunkIndex,
            chunk.text,
            serializeEmbedding(chunk.embedding, this.embeddingDimensions),
            serializeMetadata(chunk.metadata),
          ],
        });
      }
    });
  }

  public async search(options: VectorSearchOptions): Promise<readonly SearchCandidate[]> {
    this.ensureOpen();
    validateSearchLimit(options.limit);

    if (options.limit === 0) {
      return [];
    }

    const serializedEmbedding = serializeEmbedding(options.embedding, this.embeddingDimensions);
    const result = await this.db.execute({
      sql: `SELECT chunks.doc_id,
                   chunks.chunk_index,
                   chunks.chunk_text,
                   chunks.metadata,
                   vector_distance_cos(chunks.embedding, vector32(?)) AS distance
            FROM vector_top_k('${chunksEmbeddingDiskAnnIndexName}', vector32(?), ?) AS nearest
            JOIN chunks ON chunks.rowid = nearest.id
            ORDER BY distance ASC
            LIMIT ?`,
      args: [serializedEmbedding, serializedEmbedding, options.limit, options.limit],
    });

    return result.rows.map(searchCandidateFromRow);
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    try {
      if (!this.db.closed) {
        this.db.close();
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

async function withWriteTransaction(db: Client, callback: (tx: Transaction) => Promise<void>): Promise<void> {
  const tx = await db.transaction('write');

  try {
    await callback(tx);
    await tx.commit();
  } catch (error) {
    await rollbackTransaction(tx);
    throw error;
  } finally {
    if (!tx.closed) {
      tx.close();
    }
  }
}

async function rollbackTransaction(tx: Transaction): Promise<void> {
  if (tx.closed) {
    return;
  }

  try {
    await tx.rollback();
  } catch {
    if (!tx.closed) {
      tx.close();
    }
  }
}

async function assertStorageSchemaVersion(indexDir: string): Promise<void> {
  const entries = await readdir(indexDir);

  if (entries.length === 0) {
    return;
  }

  const storedVersion = await readStorageSchemaVersion(indexDir);

  if (storedVersion === String(currentStorageSchemaVersion)) {
    return;
  }

  const detail =
    storedVersion === undefined ? 'missing schema version marker' : `found schema version ${storedVersion}`;
  throw createIncompatibleIndexSchemaError(detail);
}

async function readStorageSchemaVersion(indexDir: string): Promise<string | undefined> {
  try {
    return (await readFile(storageSchemaVersionPath(indexDir), 'utf8')).trim();
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      return undefined;
    }

    throw error;
  }
}

async function writeStorageSchemaVersion(indexDir: string): Promise<void> {
  await writeFile(storageSchemaVersionPath(indexDir), `${currentStorageSchemaVersion}\n`, 'utf8');
}

function storageSchemaVersionPath(indexDir: string): string {
  return path.join(indexDir, storageSchemaVersionFileName);
}

function databaseFilePath(indexDir: string): string {
  return path.join(indexDir, databaseFileName);
}

function createIncompatibleIndexSchemaError(detail: string): Error {
  return new Error(
    `Papershelf index schema is incompatible: ${detail}. Run "papershelf index --rebuild", or delete .papershelf/index/ and run "papershelf index".`,
  );
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

async function upsertDocumentRow(tx: Transaction, document: IndexedDocument): Promise<void> {
  await tx.execute({
    sql: `INSERT INTO documents (
       doc_id,
       content_hash,
       chunker_version,
       embedding_model,
       embedding_dimensions,
       indexed_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (doc_id) DO UPDATE SET
       content_hash = EXCLUDED.content_hash,
       chunker_version = EXCLUDED.chunker_version,
       embedding_model = EXCLUDED.embedding_model,
       embedding_dimensions = EXCLUDED.embedding_dimensions,
       indexed_at = EXCLUDED.indexed_at`,
    args: [
      document.docId,
      document.contentHash,
      document.chunkerVersion,
      document.embeddingModel,
      document.embeddingDimensions,
      document.indexedAt.toISOString(),
    ],
  });
}

function documentFromRow(row: Row): IndexedDocument {
  return {
    docId: readStringColumn(row, 'doc_id'),
    contentHash: readStringColumn(row, 'content_hash'),
    chunkerVersion: readNumberColumn(row, 'chunker_version'),
    embeddingModel: readStringColumn(row, 'embedding_model'),
    embeddingDimensions: readNumberColumn(row, 'embedding_dimensions'),
    indexedAt: parseIndexedAt(readStringColumn(row, 'indexed_at')),
  };
}

function searchCandidateFromRow(row: Row): SearchCandidate {
  const candidate: SearchCandidate = {
    docId: readStringColumn(row, 'doc_id'),
    chunkIndex: readNumberColumn(row, 'chunk_index'),
    text: readStringColumn(row, 'chunk_text'),
    distance: readNumberColumn(row, 'distance'),
  };
  const metadata = parseMetadata(row['metadata']);

  if (hasMetadata(metadata)) {
    candidate.metadata = metadata;
  }

  return candidate;
}

function readStringColumn(row: Row, column: string): string {
  const value = readColumn(row, column);

  if (typeof value !== 'string') {
    throw new Error(`Invalid ${column} value in vector store: expected string.`);
  }

  return value;
}

function readNumberColumn(row: Row, column: string): number {
  const value = readColumn(row, column);

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${column} value in vector store: expected finite number.`);
  }

  return value;
}

function readColumn(row: Row, column: string): Value {
  const value = row[column];

  if (value === undefined) {
    throw new Error(`Missing ${column} value in vector store row.`);
  }

  return value;
}

function parseIndexedAt(value: string): Date {
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
