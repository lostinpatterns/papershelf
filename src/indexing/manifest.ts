import type { IndexedDocument, SourceFileFingerprint } from '../types.js';

export type IndexManifest = {
  unchanged: readonly SourceFileFingerprint[];
  changed: readonly SourceFileFingerprint[];
  deletedDocIds: readonly string[];
};

export type BuildIndexManifestOptions = {
  sourceFiles: readonly SourceFileFingerprint[];
  indexedDocuments: readonly IndexedDocument[];
  chunkerVersion: number;
  embeddingModel: string;
  embeddingDimensions: number;
};

export function buildIndexManifest(options: BuildIndexManifestOptions): IndexManifest {
  const indexedByDocId = new Map(options.indexedDocuments.map((document) => [document.docId, document]));
  const sourceDocIds = new Set<string>();
  const unchanged: SourceFileFingerprint[] = [];
  const changed: SourceFileFingerprint[] = [];

  for (const sourceFile of [...options.sourceFiles].sort(compareSourceFilesByDocId)) {
    sourceDocIds.add(sourceFile.docId);

    const indexedDocument = indexedByDocId.get(sourceFile.docId);

    if (indexedDocument !== undefined && isSourceUnchanged(sourceFile, indexedDocument, options)) {
      unchanged.push(sourceFile);
      continue;
    }

    changed.push(sourceFile);
  }

  const deletedDocIds = options.indexedDocuments
    .map((document) => document.docId)
    .filter((docId) => !sourceDocIds.has(docId))
    .sort(compareStrings);

  return {
    unchanged,
    changed,
    deletedDocIds,
  };
}

function isSourceUnchanged(
  sourceFile: SourceFileFingerprint,
  indexedDocument: IndexedDocument,
  options: BuildIndexManifestOptions,
): boolean {
  return (
    indexedDocument.contentHash === sourceFile.contentHash &&
    indexedDocument.chunkerVersion === options.chunkerVersion &&
    indexedDocument.embeddingModel === options.embeddingModel &&
    indexedDocument.embeddingDimensions === options.embeddingDimensions
  );
}

function compareSourceFilesByDocId(left: SourceFileFingerprint, right: SourceFileFingerprint): number {
  return compareStrings(left.docId, right.docId);
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}
