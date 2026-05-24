import { describe, expect, it } from 'vitest';
import type { IndexedDocument, SourceFileFingerprint } from '../types.js';
import { buildIndexManifest } from './manifest.js';

describe('buildIndexManifest', () => {
  it('splits unchanged, changed, and deleted documents using content and index metadata', () => {
    const sourceFiles = [
      createSourceFile('model-stale.md', 'same'),
      createSourceFile('new.md', 'new'),
      createSourceFile('unchanged.md', 'same'),
      createSourceFile('chunker-stale.md', 'same'),
      createSourceFile('dimensions-stale.md', 'same'),
      createSourceFile('hash-stale.md', 'current'),
    ];
    const indexedDocuments = [
      createIndexedDocument('unchanged.md', { contentHash: 'same' }),
      createIndexedDocument('hash-stale.md', { contentHash: 'old' }),
      createIndexedDocument('chunker-stale.md', { contentHash: 'same', chunkerVersion: 0 }),
      createIndexedDocument('model-stale.md', { contentHash: 'same', embeddingModel: 'old-model' }),
      createIndexedDocument('dimensions-stale.md', { contentHash: 'same', embeddingDimensions: 1279 }),
      createIndexedDocument('deleted.md', { contentHash: 'deleted' }),
    ];

    const manifest = buildIndexManifest({
      sourceFiles,
      indexedDocuments,
      chunkerVersion: 1,
      embeddingModel: 'zembed-1',
      embeddingDimensions: 1280,
    });

    expect(manifest.unchanged.map((sourceFile) => sourceFile.docId)).toEqual(['.papershelf/docs/unchanged.md']);
    expect(manifest.changed.map((sourceFile) => sourceFile.docId)).toEqual([
      '.papershelf/docs/chunker-stale.md',
      '.papershelf/docs/dimensions-stale.md',
      '.papershelf/docs/hash-stale.md',
      '.papershelf/docs/model-stale.md',
      '.papershelf/docs/new.md',
    ]);
    expect(manifest.deletedDocIds).toEqual(['.papershelf/docs/deleted.md']);
  });
});

function createSourceFile(name: string, contentHash: string): SourceFileFingerprint {
  const docId = `.papershelf/docs/${name}`;

  return {
    docId,
    absolutePath: `/repo/${docId}`,
    contentHash,
  };
}

function createIndexedDocument(
  name: string,
  overrides: Partial<Omit<IndexedDocument, 'docId' | 'indexedAt'>> = {},
): IndexedDocument {
  return {
    docId: `.papershelf/docs/${name}`,
    contentHash: overrides.contentHash ?? 'same',
    chunkerVersion: overrides.chunkerVersion ?? 1,
    embeddingModel: overrides.embeddingModel ?? 'zembed-1',
    embeddingDimensions: overrides.embeddingDimensions ?? 1280,
    indexedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
