import type { IndexedDocument, SourceFileFingerprint } from '../types.js';
import { notImplemented } from '../errors.js';

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
  void options;
  return notImplemented('index manifest construction');
}
