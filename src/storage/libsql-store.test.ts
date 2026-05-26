import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChunkMetadata, EmbeddedChunk, IndexedDocument, PapershelfPaths } from '../types.js';
import { acquireStorageLock, releaseStorageLock, type StorageLockHandle } from './lock.js';
import { openVectorStore, type VectorStore } from './libsql-store.js';
import {
  currentStorageSchemaVersion,
  storageSchemaVersionFileName,
  buildSchemaSql,
  buildVectorIndexSql,
} from './schema.js';

describe('libSQL storage schema', () => {
  it('builds document/chunk tables with fixed-size vectors and a DiskANN cosine index', () => {
    const schemaSql = buildSchemaSql({ embeddingDimensions: 1280 });
    const indexSql = buildVectorIndexSql();

    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS documents');
    expect(schemaSql).toContain('CREATE TABLE IF NOT EXISTS chunks');
    expect(schemaSql).toContain('embedding F32_BLOB(1280) NOT NULL');
    expect(schemaSql).toContain("metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata))");
    expect(schemaSql).toContain('PRIMARY KEY (doc_id, chunk_index)');
    expect(indexSql).toContain('libsql_vector_idx(embedding)');
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
      firstLock = await acquireStorageLock({ dataDir });

      expect(firstLock.lockDir).toBe(`${path.resolve(dataDir)}.lock`);
      await expect(acquireStorageLock({ dataDir })).rejects.toThrow(/locked by another process/u);

      await releaseStorageLock(firstLock);
      firstLock = undefined;

      const secondLock = await acquireStorageLock({ dataDir });
      await releaseStorageLock(secondLock);
    } finally {
      if (firstLock !== undefined) {
        await releaseStorageLock(firstLock);
      }

      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe('libSQL vector store', () => {
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

  it('writes a schema version marker for fresh indexes', async () => {
    const repoRoot = await createTemporaryDirectory();
    const paths = createPaths(repoRoot);
    const store = await openVectorStore({ paths, embeddingDimensions: 3 });

    try {
      await store.initialize();
      await store.close();

      await expect(readStorageSchemaVersion(paths.indexDir)).resolves.toBe(`${currentStorageSchemaVersion}\n`);
    } finally {
      await store.close();
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects non-empty indexes without a schema version marker', async () => {
    const repoRoot = await createTemporaryDirectory();
    const paths = createPaths(repoRoot);

    try {
      await writeNonEmptyIndexDirectory(paths.indexDir);

      await expect(openVectorStore({ paths, embeddingDimensions: 3 })).rejects.toThrow(/papershelf index --rebuild/u);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects mismatched schema versions with rebuild guidance', async () => {
    const repoRoot = await createTemporaryDirectory();
    const paths = createPaths(repoRoot);

    try {
      await writeStorageSchemaVersion(paths.indexDir, currentStorageSchemaVersion + 1);

      await expect(openVectorStore({ paths, embeddingDimensions: 3 })).rejects.toThrow(
        /delete \.papershelf\/index\/ and run "papershelf index"/u,
      );
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('rebuilds by replacing an incompatible existing index directory', async () => {
    const repoRoot = await createTemporaryDirectory();
    const paths = createPaths(repoRoot);
    let store: VectorStore | undefined;

    try {
      await writeStorageSchemaVersion(paths.indexDir, currentStorageSchemaVersion + 1);

      store = await openVectorStore({ paths, embeddingDimensions: 3, rebuild: true });
      await store.initialize();

      await expect(store.listDocuments()).resolves.toEqual([]);
      await expect(readStorageSchemaVersion(paths.indexDir)).resolves.toBe(`${currentStorageSchemaVersion}\n`);
      await store.upsertDocument(createDocument({ docId: '.papershelf/docs/rebuilt.md' }), [
        createChunk('.papershelf/docs/rebuilt.md', 0, 'rebuilt passage', [1, 0, 0]),
      ]);
      await expect(store.search({ embedding: [1, 0, 0], limit: 1 })).resolves.toMatchObject([
        { docId: '.papershelf/docs/rebuilt.md', chunkIndex: 0, text: 'rebuilt passage' },
      ]);
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

async function readStorageSchemaVersion(indexDir: string): Promise<string> {
  return await readFile(path.join(indexDir, storageSchemaVersionFileName), 'utf8');
}

async function writeStorageSchemaVersion(indexDir: string, schemaVersion: number): Promise<void> {
  await mkdir(indexDir, { recursive: true });
  await writeFile(path.join(indexDir, storageSchemaVersionFileName), `${schemaVersion}\n`, 'utf8');
}

async function writeNonEmptyIndexDirectory(indexDir: string): Promise<void> {
  await mkdir(indexDir, { recursive: true });
  await writeFile(path.join(indexDir, 'stale-index-file'), 'stale', 'utf8');
}

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
