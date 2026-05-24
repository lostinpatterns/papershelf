import type { EmbeddingInputType, EmbeddingModel, RerankModel, RerankResult } from '../types.js';
import { notImplemented } from '../errors.js';

export type ZeroEntropyClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetchImplementation?: typeof fetch;
};

export type EmbedRequest = {
  model: EmbeddingModel;
  input: readonly string[];
  inputType: EmbeddingInputType;
};

export type RerankRequest = {
  model: RerankModel;
  query: string;
  documents: readonly string[];
};

export type EmbedResponse = {
  embeddings: readonly (readonly number[])[];
};

export type RerankResponse = {
  results: readonly RerankResult[];
};

export class ZeroEntropyClient {
  public constructor(options: ZeroEntropyClientOptions) {
    void options;
  }

  public async embed(request: EmbedRequest): Promise<EmbedResponse> {
    void request;
    return notImplemented('ZeroEntropy embedding request');
  }

  public async rerank(request: RerankRequest): Promise<RerankResponse> {
    void request;
    return notImplemented('ZeroEntropy rerank request');
  }
}
