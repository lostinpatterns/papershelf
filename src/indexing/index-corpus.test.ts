import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PapershelfConfig } from '../config.js';
import type { EmbedRequest, EmbedResponse } from '../providers/zeroentropy.js';
import type { VectorStore } from '../storage/pglite-store.js';
import type { EmbeddedChunk, IndexedDocument, PapershelfPaths, SearchCandidate } from '../types.js';
import { indexCorpus } from './index-corpus.js';
import type { DocumentEmbedder } from './index-document.js';

describe('indexCorpus', () => {
  it('deletes missing docs, skips unchanged docs, and indexes changed source files', async () => {
    const repoRoot = await createTemporaryDirectory();
    const paths = createPaths(repoRoot);
    const indexedAt = new Date('2026-03-04T05:06:07.000Z');

    try {
      await mkdir(paths.docsDir, { recursive: true });
      await writeFile(path.join(paths.docsDir, 'unchanged.md'), 'Unchanged body.', 'utf8');
      await writeFile(path.join(paths.docsDir, 'changed.md'), 'Changed body.', 'utf8');
      await writeFile(path.join(paths.docsDir, 'new.txt'), 'New body.', 'utf8');
      await writeFile(path.join(paths.docsDir, 'ignored.pdf'), 'ignored', 'utf8');

      const store = new RecordingStore([
        createIndexedDocument('.papershelf/docs/unchanged.md', hashText('Unchanged body.')),
        createIndexedDocument('.papershelf/docs/changed.md', 'old-hash'),
        createIndexedDocument('.papershelf/docs/deleted.md', 'deleted-hash'),
      ]);
      const embedder = new RecordingEmbedder(3);

      const result = await indexCorpus({
        paths,
        config: createConfig(3),
        chunkerOptions: { targetWords: 100, overlapWords: 0, maxCharacters: 1000 },
        chunkerVersion: 1,
        embedder,
        store,
        now: () => indexedAt,
      });

      expect(result).toEqual({
        stdout:
          'Indexed papershelf corpus.\n' +
          'Source files: 3\n' +
          'Unchanged documents: 1\n' +
          'Indexed documents: 2\n' +
          'Deleted documents: 1\n' +
          'Indexed chunks: 2',
        exitCode: 0,
      });
      expect(store.deletedDocIds).toEqual(['.papershelf/docs/deleted.md']);
      expect(store.upsertedDocuments).toEqual([
        createIndexedDocument('.papershelf/docs/changed.md', hashText('Changed body.'), indexedAt),
        createIndexedDocument('.papershelf/docs/new.txt', hashText('New body.'), indexedAt),
      ]);
      expect(store.upsertedChunks.map((chunks) => chunks.map((chunk) => chunk.text))).toEqual([
        ['Changed body.'],
        ['New body.'],
      ]);
      expect(embedder.calls.map((call) => call.input)).toEqual([['Changed body.'], ['New body.']]);
      expect(embedder.calls.every((call) => call.inputType === 'document')).toBe(true);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

class RecordingStore implements VectorStore {
  public readonly deletedDocIds: string[] = [];
  public readonly upsertedDocuments: IndexedDocument[] = [];
  public readonly upsertedChunks: (readonly EmbeddedChunk[])[] = [];
  private documents: IndexedDocument[];

  public constructor(documents: readonly IndexedDocument[]) {
    this.documents = [...documents];
  }

  public async initialize(): Promise<void> {
    return undefined;
  }

  public async getDocument(docId: string): Promise<IndexedDocument | undefined> {
    return this.documents.find((document) => document.docId === docId);
  }

  public async listDocuments(): Promise<readonly IndexedDocument[]> {
    return this.documents;
  }

  public async deleteDocument(docId: string): Promise<void> {
    this.deletedDocIds.push(docId);
    this.documents = this.documents.filter((document) => document.docId !== docId);
  }

  public async upsertDocument(document: IndexedDocument, chunks: readonly EmbeddedChunk[]): Promise<void> {
    this.upsertedDocuments.push(document);
    this.upsertedChunks.push(chunks);
    this.documents = [...this.documents.filter((stored) => stored.docId !== document.docId), document];
  }

  public async search(): Promise<readonly SearchCandidate[]> {
    return [];
  }

  public async close(): Promise<void> {
    return undefined;
  }
}

class RecordingEmbedder implements DocumentEmbedder {
  public readonly calls: EmbedRequest[] = [];
  private readonly embeddingDimensions: number;

  public constructor(embeddingDimensions: number) {
    this.embeddingDimensions = embeddingDimensions;
  }

  public async embed(request: EmbedRequest): Promise<EmbedResponse> {
    this.calls.push(request);

    return {
      embeddings: request.input.map((_text, index) => createEmbedding(this.embeddingDimensions, index + 1)),
    };
  }
}

async function createTemporaryDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'papershelf-index-corpus-'));
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

function createConfig(embeddingDimensions: number): PapershelfConfig {
  return {
    zeroEntropyApiKey: 'test-key',
    zeroEntropyBaseUrl: 'https://api.zeroentropy.dev/v1',
    embeddingModel: 'zembed-1',
    embeddingDimensions,
    rerankModel: 'zerank-2',
    defaultCandidateLimit: 30,
    defaultResultLimit: 5,
  };
}

function createIndexedDocument(docId: string, contentHash: string, indexedAt?: Date): IndexedDocument {
  return {
    docId,
    contentHash,
    chunkerVersion: 1,
    embeddingModel: 'zembed-1',
    embeddingDimensions: 3,
    indexedAt: indexedAt ?? new Date('2026-01-01T00:00:00.000Z'),
  };
}

function hashText(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function createEmbedding(dimensions: number, firstValue: number): readonly number[] {
  return Array.from({ length: dimensions }, (_value, index) => (index === 0 ? firstValue : 0));
}
