import type { EmbeddedChunk, EmbeddingModel, IndexedDocument, SourceDocument, TextChunk } from '../types.js';
import type { EmbedRequest, EmbedResponse } from '../providers/zeroentropy.js';
import { chunkDocument, type ChunkerOptions } from '../chunkers/text-boundaries.js';

export type DocumentEmbedder = {
  embed(request: EmbedRequest): Promise<EmbedResponse>;
};

export type IndexDocumentOptions = {
  document: SourceDocument;
  chunkerOptions: ChunkerOptions;
  chunkerVersion: number;
  embeddingModel: EmbeddingModel;
  embeddingDimensions: number;
  embedder: DocumentEmbedder;
  indexedAt?: Date;
};

export type IndexDocumentResult = {
  document: IndexedDocument;
  chunks: readonly EmbeddedChunk[];
};

export async function indexDocument(options: IndexDocumentOptions): Promise<IndexDocumentResult> {
  validateEmbeddingDimensions(options.embeddingDimensions);

  const chunks = chunkDocument(options.document, options.chunkerOptions);
  const embeddings = await embedChunks(options, chunks);
  const embeddedChunks = attachEmbeddings(options.document.docId, chunks, embeddings, options.embeddingDimensions);

  return {
    document: {
      docId: options.document.docId,
      contentHash: options.document.contentHash,
      chunkerVersion: options.chunkerVersion,
      embeddingModel: options.embeddingModel,
      embeddingDimensions: options.embeddingDimensions,
      indexedAt: options.indexedAt ?? new Date(),
    },
    chunks: embeddedChunks,
  };
}

async function embedChunks(
  options: IndexDocumentOptions,
  chunks: readonly TextChunk[],
): Promise<readonly (readonly number[])[]> {
  if (chunks.length === 0) {
    return [];
  }

  const response = await options.embedder.embed({
    model: options.embeddingModel,
    input: chunks.map((chunk) => chunk.text),
    inputType: 'document',
  });

  return response.embeddings;
}

function attachEmbeddings(
  docId: string,
  chunks: readonly TextChunk[],
  embeddings: readonly (readonly number[])[],
  embeddingDimensions: number,
): readonly EmbeddedChunk[] {
  if (embeddings.length !== chunks.length) {
    throw new Error(`Embedding count mismatch for ${docId}: expected ${chunks.length}, received ${embeddings.length}.`);
  }

  return chunks.map((chunk, index) => {
    const embedding = embeddings[index];

    if (embedding === undefined) {
      throw new Error(`Missing embedding for ${docId} chunk ${index}.`);
    }

    validateEmbedding(docId, index, embedding, embeddingDimensions);

    return {
      ...chunk,
      embedding,
    };
  });
}

function validateEmbedding(
  docId: string,
  chunkIndex: number,
  embedding: readonly number[],
  expectedDimensions: number,
): void {
  if (embedding.length !== expectedDimensions) {
    throw new Error(
      `Embedding dimension mismatch for ${docId} chunk ${chunkIndex}: expected ${expectedDimensions}, received ${embedding.length}.`,
    );
  }

  if (!embedding.every(Number.isFinite)) {
    throw new Error(`Embedding for ${docId} chunk ${chunkIndex} must contain only finite numbers.`);
  }
}

function validateEmbeddingDimensions(embeddingDimensions: number): void {
  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions <= 0) {
    throw new Error('Embedding dimensions must be a positive integer.');
  }
}
