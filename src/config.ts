import type { EmbeddingModel, RerankModel } from './types.js';

export type PapershelfConfig = {
  zeroEntropyApiKey: string;
  zeroEntropyBaseUrl: string;
  embeddingModel: EmbeddingModel;
  embeddingDimensions: number;
  rerankModel: RerankModel;
  defaultCandidateLimit: number;
  defaultResultLimit: number;
};

export const defaultZeroEntropyBaseUrl: string = 'https://api.zeroentropy.dev/v1';
export const defaultEmbeddingModel: EmbeddingModel = 'zembed-1';
export const defaultRerankModel: RerankModel = 'zerank-2';
export const defaultEmbeddingDimensions: number = 1280;
export const defaultCandidateLimit: number = 30;
export const defaultResultLimit: number = 5;

export function loadConfig(env: Readonly<NodeJS.ProcessEnv>): PapershelfConfig {
  const zeroEntropyApiKey = env['ZEROENTROPY_API_KEY']?.trim();

  if (zeroEntropyApiKey === undefined || zeroEntropyApiKey.length === 0) {
    throw new Error('Missing ZEROENTROPY_API_KEY environment variable. Set it before running index or search.');
  }

  return {
    zeroEntropyApiKey,
    zeroEntropyBaseUrl: defaultZeroEntropyBaseUrl,
    embeddingModel: defaultEmbeddingModel,
    embeddingDimensions: defaultEmbeddingDimensions,
    rerankModel: defaultRerankModel,
    defaultCandidateLimit,
    defaultResultLimit,
  };
}
