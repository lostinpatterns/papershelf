export const currentStorageSchemaVersion: number = 1;
export const storageSchemaVersionFileName: string = '.papershelf-schema-version';
export const documentsTableName: string = 'documents';
export const chunksTableName: string = 'chunks';
export const chunksEmbeddingHnswIndexName: string = 'chunks_embedding_hnsw_cosine_idx';

export type SchemaOptions = {
  embeddingDimensions: number;
};

export function buildSchemaSql(options: SchemaOptions): string {
  validateEmbeddingDimensions(options.embeddingDimensions);

  return `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS ${documentsTableName} (
  doc_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  chunker_version INTEGER NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ${chunksTableName} (
  doc_id TEXT NOT NULL REFERENCES ${documentsTableName}(doc_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_text TEXT NOT NULL,
  embedding vector(${options.embeddingDimensions}) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (doc_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_doc_id_idx ON ${chunksTableName} (doc_id);
`.trim();
}

export function buildVectorIndexSql(): string {
  return `CREATE INDEX IF NOT EXISTS ${chunksEmbeddingHnswIndexName} ON ${chunksTableName} USING hnsw (embedding vector_cosine_ops);`;
}

function validateEmbeddingDimensions(embeddingDimensions: number): void {
  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions <= 0) {
    throw new Error('Embedding dimensions must be a positive integer.');
  }
}
