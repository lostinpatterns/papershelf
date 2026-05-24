import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChunkMetadata, EmbeddedChunk, IndexedDocument, PapershelfPaths } from '../types.js';
import { acquireStorageLock, releaseStorageLock, type StorageLockHandle } from './lock.js';
import { openVectorStore, type VectorStore } from './pglite-store.js';
import { buildSchemaSql, buildVectorIndexSql } from './schema.js';

describe('PGlite storage schema', () => {
  it('builds document/chunk tables with fixed-size vectors and an HNSW cosine index', () => {
    const schemaSql = buildSchemaSql({ embeddingDimensions: 1280 });
    const indexSql = buildVectorIndexSql();

    expect(schemaSql).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS documents');
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS chunks');
    expect(schemaSql).toContain('embedding vector(1280) NOT NULL');
    expect(schemaSql).toContain('PRIMARY KEY (doc_id, chunk_index)');
    expect(indexSql).toContain('USING hnsw');
    expect(indexSql).toContain('vector_cosine_ops');
  });

  it('rejects invalid embedding dimensions', () => {
    expect(() => buildSchemaSql({ embeddingDimensions: 0 })).toThrow(/positive integer/u);
  });
});

describe('storage lock', () => {
  it('guards a repo-local index directory until released', async () => {
    const repoRoot = await createTemporaryDirectory();
    const dataDir = path.join(repoRoot, '.papershelf', 'index');
    let firstLock: StorageLockHandle | undefined;

    try {
      firstLock = await acquireStorageLock({ dataDir, timeoutMs: 100 });

      expect(firstLock.acquired).toBe(true);
      expect(firstLock.lockDir).toBe(`${path.resolve(dataDir)}.lock`);
      await expect(acquireStorageLock({ dataDir, timeoutMs: 1 })).rejects.toThrow(/locked by another process/u);

      await releaseStorageLock(firstLock);
      firstLock = undefined;

      const secondLock = await acquireStorageLock({ dataDir, timeoutMs: 100 });
      await releaseStorageLock(secondLock);
    } finally {
      if (firstLock !== undefined) {
        await releaseStorageLock(firstLock);
      }

      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('PGlite vector store', () => {
  it('initializes schema, upserts replacement chunks, searches by cosine distance, deletes, and reopens cleanly', async () => {
    const repoRoot = await createTemporaryDirectory();
    const paths = createPaths(repoRoot);
    const docId = '.papershelf/docs/paper.md';
    let store: VectorStore | undefined;

    try {
      store = await openVectorStore({ paths, embeddingDimensions: 3 });
      await store.initialize();

      const indexedAt = new Date('2026-01-01T00:00:00.000Z');
      const document = createDocument({ docId, contentHash: 'hash-one', indexedAt });

      await store.upsertDocument(document, [
        createChunk(docId, 0, 'alpha passage', [1, 0, 0], { heading: 'Introduction', page: 1 }),
        createChunk(docId, 1, 'beta passage', [0.5, 0.5, 0], { section: 'Introduction > Method' }),
      ]);

      await expect(store.listDocuments()).resolves.toEqual([document]);

      const searchResults = await store.search({ embedding: [1, 0, 0], limit: 2 });

      expect(searchResults).toHaveLength(2);
      expect(searchResults[0]).toMatchObject({
        docId,
        chunkIndex: 0,
        text: 'alpha passage',
        metadata: { heading: 'Introduction', page: 1 },
      });
      expect(searchResults[0]?.distance).toBeCloseTo(0);
      expect(searchResults[1]).toMatchObject({
        docId,
        chunkIndex: 1,
        text: 'beta passage',
        metadata: { section: 'Introduction > Method' },
      });

      const replacementDocument = createDocument({
        docId,
        contentHash: 'hash-two',
        indexedAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      await store.upsertDocument(replacementDocument, [createChunk(docId, 0, 'replacement gamma passage', [0, 0, 1])]);
      await expect(store.listDocuments()).resolves.toEqual([replacementDocument]);
      await expect(store.search({ embedding: [1, 0, 0], limit: 10 })).resolves.toEqual([
        {
          docId,
          chunkIndex: 0,
          text: 'replacement gamma passage',
          distance: 1,
        },
      ]);

      await store.close();
      store = await openVectorStore({ paths, embeddingDimensions: 3 });
      await store.initialize();

      await expect(store.listDocuments()).resolves.toEqual([replacementDocument]);
      await store.deleteDocument(docId);
      await expect(store.listDocuments()).resolves.toEqual([]);
      await expect(store.search({ embedding: [1, 0, 0], limit: 10 })).resolves.toEqual([]);
    } finally {
      if (store !== undefined) {
        await store.close();
      }

      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('validates embedding dimensions before writing or searching', async () => {
    const repoRoot = await createTemporaryDirectory();
    const paths = createPaths(repoRoot);
    const store = await openVectorStore({ paths, embeddingDimensions: 3 });
    const docId = '.papershelf/docs/paper.md';

    try {
      await store.initialize();
      await expect(
        store.upsertDocument(createDocument({ docId }), [createChunk(docId, 0, 'bad chunk', [1, 0])]),
      ).rejects.toThrow(/Embedding dimension mismatch/u);
      await expect(store.search({ embedding: [1, 0], limit: 1 })).rejects.toThrow(/Embedding dimension mismatch/u);
    } finally {
      await store.close();
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 30_000);
});

async function createTemporaryDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'papershelf-storage-'));
}

function createPaths(repoRoot: string): PapershelfPaths {
  const papershelfDir = path.join(repoRoot, '.papershelf');

  return {
    repoRoot,
    papershelfDir,
    docsDir: path.join(papershelfDir, 'docs'),
    indexDir: path.join(papershelfDir, 'index'),
    bundledSkillPath: path.join(repoRoot, 'skills', 'papershelf', 'SKILL.md'),
    installedSkillPath: path.join(repoRoot, '.agents', 'skills', 'papershelf', 'SKILL.md'),
  };
}

function createDocument(options: {
  docId: string;
  contentHash?: string;
  indexedAt?: Date;
  embeddingDimensions?: number;
}): IndexedDocument {
  return {
    docId: options.docId,
    contentHash: options.contentHash ?? 'hash',
    chunkerVersion: 1,
    embeddingModel: 'zembed-1',
    embeddingDimensions: options.embeddingDimensions ?? 3,
    indexedAt: options.indexedAt ?? new Date('2026-01-01T00:00:00.000Z'),
  };
}

function createChunk(
  docId: string,
  chunkIndex: number,
  text: string,
  embedding: readonly number[],
  metadata?: ChunkMetadata,
): EmbeddedChunk {
  const chunk: EmbeddedChunk = {
    docId,
    chunkIndex,
    text,
    embedding,
  };

  if (metadata !== undefined) {
    chunk.metadata = metadata;
  }

  return chunk;
}
