import type { EmbeddingInputType, EmbeddingModel, RerankModel, RerankResult } from '../types.js';

export type ZeroEntropyClientOptions = {
  apiKey: string;
  baseUrl: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
};

export type EmbedRequest = {
  model: EmbeddingModel;
  input: readonly string[];
  inputType: EmbeddingInputType;
  signal?: AbortSignal;
};

export type RerankRequest = {
  model: RerankModel;
  query: string;
  documents: readonly string[];
  signal?: AbortSignal;
};

export type EmbedResponse = {
  embeddings: readonly (readonly number[])[];
};

export type RerankResponse = {
  results: readonly RerankResult[];
};

type AbortSetup = {
  signal: AbortSignal | undefined;
  cleanup: () => void;
};

export class ZeroEntropyClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number | undefined;

  public constructor(options: ZeroEntropyClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs;
  }

  public async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const responseBody = await this.postJson(
      'embed',
      '/models/embed',
      {
        model: request.model,
        input: [...request.input],
        input_type: request.inputType,
        encoding_format: 'float',
      },
      request.signal,
    );

    return {
      embeddings: parseEmbedResponse(responseBody, request.input.length),
    };
  }

  public async rerank(request: RerankRequest): Promise<RerankResponse> {
    const responseBody = await this.postJson(
      'rerank',
      '/models/rerank',
      {
        model: request.model,
        query: request.query,
        documents: [...request.documents],
      },
      request.signal,
    );

    return {
      results: parseRerankResponse(responseBody, request.documents.length),
    };
  }

  private async postJson(
    operation: 'embed' | 'rerank',
    path: '/models/embed' | '/models/rerank',
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const abortSetup = this.createAbortSetup(signal);
    const requestInit: RequestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    };

    if (abortSetup.signal !== undefined) {
      requestInit.signal = abortSetup.signal;
    }

    try {
      const response = await this.fetchImplementation(`${this.baseUrl}${path}`, requestInit);

      if (!response.ok) {
        throw new Error(await formatHttpError(operation, response));
      }

      return await parseJsonResponse(operation, response);
    } finally {
      abortSetup.cleanup();
    }
  }

  private createAbortSetup(externalSignal: AbortSignal | undefined): AbortSetup {
    if (this.timeoutMs === undefined) {
      return {
        signal: externalSignal,
        cleanup: () => undefined,
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error(`ZeroEntropy request timed out after ${this.timeoutMs}ms.`));
    }, this.timeoutMs);

    const abortFromExternalSignal = (): void => {
      controller.abort(externalSignal?.reason);
    };

    if (externalSignal?.aborted === true) {
      abortFromExternalSignal();
    } else {
      externalSignal?.addEventListener('abort', abortFromExternalSignal, { once: true });
    }

    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', abortFromExternalSignal);
      },
    };
  }
}

async function formatHttpError(operation: 'embed' | 'rerank', response: Response): Promise<string> {
  const statusText = response.statusText.length > 0 ? ` ${response.statusText}` : '';
  const body = await readResponseText(response);
  const bodySuffix = body.length > 0 ? `: ${body}` : '';

  return `ZeroEntropy ${operation} request failed with HTTP ${response.status}${statusText}${bodySuffix}`;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return '<failed to read response body>';
  }
}

async function parseJsonResponse(operation: 'embed' | 'rerank', response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw malformedResponse(operation, 'response body is not valid JSON');
  }
}

function parseEmbedResponse(body: unknown, expectedCount: number): readonly (readonly number[])[] {
  const results = readResultsArray('embed', body);
  const embeddings = results.map((result, index) => readEmbedding(result, index));

  if (embeddings.length !== expectedCount) {
    throw malformedResponse(
      'embed',
      `embedding count mismatch: expected ${expectedCount}, received ${embeddings.length}`,
    );
  }

  return embeddings;
}

function parseRerankResponse(body: unknown, documentCount: number): readonly RerankResult[] {
  return readResultsArray('rerank', body).map((result, position) => readRerankResult(result, position, documentCount));
}

function readResultsArray(operation: 'embed' | 'rerank', body: unknown): readonly unknown[] {
  if (!isRecord(body)) {
    throw malformedResponse(operation, 'expected a JSON object');
  }

  const results = body['results'];

  if (!Array.isArray(results)) {
    throw malformedResponse(operation, 'expected results to be an array');
  }

  return results;
}

function readEmbedding(result: unknown, index: number): readonly number[] {
  if (!isRecord(result)) {
    throw malformedResponse('embed', `expected results[${index}] to be an object`);
  }

  const embedding = result['embedding'];

  if (!Array.isArray(embedding) || !embedding.every(isFiniteNumber)) {
    throw malformedResponse('embed', `expected results[${index}].embedding to be an array of numbers`);
  }

  return embedding;
}

function readRerankResult(result: unknown, position: number, documentCount: number): RerankResult {
  if (!isRecord(result)) {
    throw malformedResponse('rerank', `expected results[${position}] to be an object`);
  }

  const index = result['index'];
  const relevanceScore = result['relevance_score'];

  if (!Number.isInteger(index) || typeof index !== 'number') {
    throw malformedResponse('rerank', `expected results[${position}].index to be an integer`);
  }

  if (index < 0 || index >= documentCount) {
    throw malformedResponse('rerank', `results[${position}].index is outside the documents array`);
  }

  if (!isFiniteNumber(relevanceScore)) {
    throw malformedResponse('rerank', `expected results[${position}].relevance_score to be a number`);
  }

  return {
    index,
    relevanceScore,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function malformedResponse(operation: 'embed' | 'rerank', reason: string): Error {
  return new Error(`Malformed ZeroEntropy ${operation} response: ${reason}.`);
}
