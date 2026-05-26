export const currentStorageSchemaVersion: number = 2;
export const storageSchemaVersionFileName: string = '.papershelf-schema-version';
export const documentsTableName: string = 'documents';
export const chunksTableName: string = 'chunks';
export const chunksEmbeddingDiskAnnIndexName: string = 'chunks_embedding_diskann_cosine_idx';

export type SchemaOptions = {
  embeddingDimensions: number;
};

export function buildSchemaSql(options: SchemaOptions): string {
  validateEmbeddingDimensions(options.embeddingDimensions);

  return `
CREATE TABLE IF NOT EXISTS ${documentsTableName} (
  doc_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  chunker_version INTEGER NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL,
  indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ${chunksTableName} (
  doc_id TEXT NOT NULL REFERENCES ${documentsTableName}(doc_id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_text TEXT NOT NULL,
  embedding F32_BLOB(${options.embeddingDimensions}) NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  PRIMARY KEY (doc_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS chunks_doc_id_idx ON ${chunksTableName} (doc_id);
`.trim();
}

export function buildVectorIndexSql(): string {
  return `CREATE INDEX IF NOT EXISTS ${chunksEmbeddingDiskAnnIndexName} ON ${chunksTableName} (libsql_vector_idx(embedding));`;
}

function validateEmbeddingDimensions(embeddingDimensions: number): void {
  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions <= 0) {
    throw new Error('Embedding dimensions must be a positive integer.');
  }
}
