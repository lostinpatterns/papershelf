import { notImplemented } from '../errors.js';

export const documentsTableName: string = 'documents';
export const chunksTableName: string = 'chunks';

export type SchemaOptions = {
  embeddingDimensions: number;
};

export function buildSchemaSql(options: SchemaOptions): string {
  void options;
  return notImplemented('PGlite schema SQL');
}

export function buildVectorIndexSql(): string {
  return notImplemented('pgvector HNSW index SQL');
}
