import { describe, expect, it } from 'vitest';
import {
  defaultCandidateLimit,
  defaultEmbeddingDimensions,
  defaultEmbeddingModel,
  defaultResultLimit,
  defaultRerankModel,
  defaultZeroEntropyBaseUrl,
  loadConfig,
} from './config.js';

describe('loadConfig', () => {
  it('reads ZEROENTROPY_API_KEY and returns defaults', () => {
    expect(loadConfig({ ZEROENTROPY_API_KEY: 'test-key' })).toEqual({
      zeroEntropyApiKey: 'test-key',
      zeroEntropyBaseUrl: defaultZeroEntropyBaseUrl,
      embeddingModel: defaultEmbeddingModel,
      embeddingDimensions: defaultEmbeddingDimensions,
      rerankModel: defaultRerankModel,
      defaultCandidateLimit,
      defaultResultLimit,
    });
  });

  it('reads ZEROENTROPY_BASE_URL when provided', () => {
    expect(
      loadConfig({
        ZEROENTROPY_API_KEY: 'test-key',
        ZEROENTROPY_BASE_URL: ' http://127.0.0.1:1234/v1 ',
      }).zeroEntropyBaseUrl,
    ).toBe('http://127.0.0.1:1234/v1');
  });

  it('throws a clear error when ZEROENTROPY_API_KEY is missing', () => {
    expect(() => loadConfig({})).toThrow(/ZEROENTROPY_API_KEY/);
  });

  it('throws a clear error when ZEROENTROPY_API_KEY is blank', () => {
    expect(() => loadConfig({ ZEROENTROPY_API_KEY: '   ' })).toThrow(/ZEROENTROPY_API_KEY/);
  });
});
