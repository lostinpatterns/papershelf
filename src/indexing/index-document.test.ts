import { describe, expect, it } from 'vitest';
import type { EmbedRequest, EmbedResponse } from '../providers/zeroentropy.js';
import type { SourceDocument } from '../types.js';
import { indexDocument, type DocumentEmbedder } from './index-document.js';

describe('indexDocument', () => {
  it('chunks a source document, embeds chunks as documents, and builds indexed records', async () => {
    const embedder = new RecordingEmbedder(3);
    const indexedAt = new Date('2026-02-03T04:05:06.000Z');

    const result = await indexDocument({
      document: createDocument('# Heading\n\nThis passage should be embedded.'),
      chunkerOptions: { targetWords: 100, overlapWords: 0, maxCharacters: 1000 },
      chunkerVersion: 7,
      embeddingModel: 'zembed-1',
      embeddingDimensions: 3,
      embedder,
      indexedAt,
    });

    expect(embedder.calls).toEqual([
      {
        model: 'zembed-1',
        input: ['# Heading\n\nThis passage should be embedded.'],
        inputType: 'document',
        dimensions: 3,
      },
    ]);
    expect(result.document).toEqual({
      docId: '.papershelf/docs/test.md',
      contentHash: 'content-hash',
      chunkerVersion: 7,
      embeddingModel: 'zembed-1',
      embeddingDimensions: 3,
      indexedAt,
    });
    expect(result.chunks).toEqual([
      {
        docId: '.papershelf/docs/test.md',
        chunkIndex: 0,
        text: '# Heading\n\nThis passage should be embedded.',
        metadata: {
          heading: 'Heading',
          section: 'Heading',
          startLine: 1,
          endLine: 3,
        },
        embedding: [1, 0, 0],
      },
    ]);
  });

  it('indexes empty documents without calling the embedding API', async () => {
    const embedder = new RecordingEmbedder(3);

    const result = await indexDocument({
      document: createDocument('   \n\n'),
      chunkerOptions: { targetWords: 100, overlapWords: 0, maxCharacters: 1000 },
      chunkerVersion: 1,
      embeddingModel: 'zembed-1',
      embeddingDimensions: 3,
      embedder,
      indexedAt: new Date('2026-02-03T04:05:06.000Z'),
    });

    expect(embedder.calls).toEqual([]);
    expect(result.chunks).toEqual([]);
  });

  it('rejects embeddings with unexpected dimensions', async () => {
    const embedder: DocumentEmbedder = {
      embed: async () => ({ embeddings: [[1, 0]] }),
    };

    await expect(
      indexDocument({
        document: createDocument('A chunk.'),
        chunkerOptions: { targetWords: 100, overlapWords: 0, maxCharacters: 1000 },
        chunkerVersion: 1,
        embeddingModel: 'zembed-1',
        embeddingDimensions: 3,
        embedder,
      }),
    ).rejects.toThrow(/Embedding dimension mismatch/u);
  });
});

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

function createDocument(text: string): SourceDocument {
  return {
    docId: '.papershelf/docs/test.md',
    absolutePath: '/repo/.papershelf/docs/test.md',
    contentHash: 'content-hash',
    text,
  };
}

function createEmbedding(dimensions: number, firstValue: number): readonly number[] {
  return Array.from({ length: dimensions }, (_value, index) => (index === 0 ? firstValue : 0));
}
