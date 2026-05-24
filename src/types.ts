export type CliResult = {
  stdout?: string;
  stderr?: string;
  exitCode: number;
};

export type CommandContext = {
  cwd: string;
  env: Readonly<NodeJS.ProcessEnv>;
};

export type SearchOutputFormat = 'text' | 'json';

export type EmbeddingInputType = 'document' | 'query';
export type EmbeddingModel = 'zembed-1';
export type RerankModel = 'zerank-2';

export type SupportedSourceFileExtension = '.txt' | '.md' | '.markdown';

export type PapershelfPaths = {
  repoRoot: string;
  papershelfDir: string;
  docsDir: string;
  indexDir: string;
  bundledSkillPath: string;
  installedSkillPath: string;
};

export type SourceFile = {
  docId: string;
  absolutePath: string;
};

export type SourceFileFingerprint = SourceFile & {
  contentHash: string;
};

export type SourceDocument = SourceFileFingerprint & {
  text: string;
};

export type IndexedDocument = {
  docId: string;
  contentHash: string;
  chunkerVersion: number;
  embeddingModel: string;
  embeddingDimensions: number;
  indexedAt: Date;
};

export type ChunkMetadata = {
  heading?: string;
  section?: string;
  page?: number;
  startLine?: number;
  endLine?: number;
};

export type TextChunk = {
  docId: string;
  chunkIndex: number;
  text: string;
  metadata?: ChunkMetadata;
};

export type EmbeddedChunk = TextChunk & {
  embedding: readonly number[];
};

export type SearchCandidate = TextChunk & {
  distance: number;
};

export type SearchResult = SearchCandidate & {
  relevanceScore?: number;
};

export type RerankResult = {
  index: number;
  relevanceScore: number;
};
