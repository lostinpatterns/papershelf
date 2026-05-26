import type { PapershelfConfig } from '../config.js';
import type { ChunkerOptions } from '../chunkers/text-boundaries.js';
import { hashSourceFileBytes, listSourceFiles, readSourceFileText } from '../source-files/index.js';
import type { VectorStore } from '../storage/libsql-store.js';
import type { CliResult, PapershelfPaths, SourceDocument, SourceFile, SourceFileFingerprint } from '../types.js';
import { indexDocument, type DocumentEmbedder } from './index-document.js';
import { buildIndexManifest } from './manifest.js';

export type IndexCorpusOptions = {
  paths: PapershelfPaths;
  config: PapershelfConfig;
  chunkerOptions: ChunkerOptions;
  chunkerVersion: number;
  embedder: DocumentEmbedder;
  store: VectorStore;
  now?: () => Date;
};

export async function indexCorpus(options: IndexCorpusOptions): Promise<CliResult> {
  const sourceFiles = await listSourceFiles({ paths: options.paths });
  const sourceFingerprints = await fingerprintSourceFiles(sourceFiles);
  const indexedDocuments = await options.store.listDocuments();
  const manifest = buildIndexManifest({
    sourceFiles: sourceFingerprints,
    indexedDocuments,
    chunkerVersion: options.chunkerVersion,
    embeddingModel: options.config.embeddingModel,
    embeddingDimensions: options.config.embeddingDimensions,
  });

  for (const docId of manifest.deletedDocIds) {
    await options.store.deleteDocument(docId);
  }

  let indexedChunkCount = 0;

  for (const sourceFile of manifest.changed) {
    const sourceDocument = await readSourceDocument(sourceFile);
    const indexed = await indexDocument({
      document: sourceDocument,
      chunkerOptions: options.chunkerOptions,
      chunkerVersion: options.chunkerVersion,
      embeddingModel: options.config.embeddingModel,
      embeddingDimensions: options.config.embeddingDimensions,
      embedder: options.embedder,
      indexedAt: options.now?.() ?? new Date(),
    });

    await options.store.upsertDocument(indexed.document, indexed.chunks);
    indexedChunkCount += indexed.chunks.length;
  }

  return {
    stdout: formatIndexSummary({
      sourceFileCount: sourceFingerprints.length,
      unchangedDocumentCount: manifest.unchanged.length,
      indexedDocumentCount: manifest.changed.length,
      deletedDocumentCount: manifest.deletedDocIds.length,
      indexedChunkCount,
    }),
    exitCode: 0,
  };
}

async function fingerprintSourceFiles(sourceFiles: readonly SourceFile[]): Promise<readonly SourceFileFingerprint[]> {
  return await Promise.all(sourceFiles.map(fingerprintSourceFile));
}

async function fingerprintSourceFile(sourceFile: SourceFile): Promise<SourceFileFingerprint> {
  return {
    ...sourceFile,
    contentHash: await hashSourceFileBytes(sourceFile),
  };
}

async function readSourceDocument(sourceFile: SourceFileFingerprint): Promise<SourceDocument> {
  return {
    ...sourceFile,
    text: await readSourceFileText({ file: sourceFile }),
  };
}

type IndexSummary = {
  sourceFileCount: number;
  unchangedDocumentCount: number;
  indexedDocumentCount: number;
  deletedDocumentCount: number;
  indexedChunkCount: number;
};

function formatIndexSummary(summary: IndexSummary): string {
  return [
    'Indexed papershelf corpus.',
    `Source files: ${summary.sourceFileCount}`,
    `Unchanged documents: ${summary.unchangedDocumentCount}`,
    `Indexed documents: ${summary.indexedDocumentCount}`,
    `Deleted documents: ${summary.deletedDocumentCount}`,
    `Indexed chunks: ${summary.indexedChunkCount}`,
  ].join('\n');
}
