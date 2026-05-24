import { describe, expect, it } from 'vitest';
import { ZeroEntropyClient } from './zeroentropy.js';

type FetchCall = {
  input: Parameters<typeof fetch>[0];
  init: Parameters<typeof fetch>[1];
};

type MockFetch = {
  fetchImplementation: typeof fetch;
  calls: FetchCall[];
};

describe('ZeroEntropyClient', () => {
  it('sends native embed requests with bearer auth and parses embeddings', async () => {
    const mockFetch = createJsonFetch({
      results: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      usage: { total_tokens: 4 },
    });
    const client = createClient(mockFetch, { baseUrl: 'https://api.zeroentropy.dev/v1/' });

    await expect(
      client.embed({
        model: 'zembed-1',
        input: ['first chunk', 'second chunk'],
        inputType: 'document',
      }),
    ).resolves.toEqual({
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });

    const call = onlyCall(mockFetch);
    const requestInit = requireRequestInit(call);
    const headers = new Headers(requestInit.headers);

    expect(call.input).toBe('https://api.zeroentropy.dev/v1/models/embed');
    expect(requestInit.method).toBe('POST');
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(headers.get('content-type')).toBe('application/json');
    expect(readJsonRequestBody(requestInit)).toEqual({
      model: 'zembed-1',
      input: ['first chunk', 'second chunk'],
      input_type: 'document',
      encoding_format: 'float',
    });
  });

  it('sends native rerank requests and maps relevance_score to relevanceScore', async () => {
    const mockFetch = createJsonFetch({
      results: [
        { index: 1, relevance_score: 0.98 },
        { index: 0, relevance_score: 0.12 },
      ],
    });
    const client = createClient(mockFetch);

    await expect(
      client.rerank({
        model: 'zerank-2',
        query: 'what does the paper say?',
        documents: ['first passage', 'second passage'],
      }),
    ).resolves.toEqual({
      results: [
        { index: 1, relevanceScore: 0.98 },
        { index: 0, relevanceScore: 0.12 },
      ],
    });

    const call = onlyCall(mockFetch);
    const requestInit = requireRequestInit(call);
    const headers = new Headers(requestInit.headers);

    expect(call.input).toBe('https://api.zeroentropy.dev/v1/models/rerank');
    expect(requestInit.method).toBe('POST');
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(readJsonRequestBody(requestInit)).toEqual({
      model: 'zerank-2',
      query: 'what does the paper say?',
      documents: ['first passage', 'second passage'],
    });
  });

  it('throws useful errors for non-2xx embed responses', async () => {
    const mockFetch = createTextFetch('bad api key', { status: 401, statusText: 'Unauthorized' });
    const client = createClient(mockFetch);

    await expect(
      client.embed({
        model: 'zembed-1',
        input: ['chunk'],
        inputType: 'document',
      }),
    ).rejects.toThrow(/ZeroEntropy embed request failed with HTTP 401 Unauthorized: bad api key/u);
  });

  it('throws useful errors for non-2xx rerank responses', async () => {
    const mockFetch = createTextFetch('rate limited', { status: 429, statusText: 'Too Many Requests' });
    const client = createClient(mockFetch);

    await expect(
      client.rerank({
        model: 'zerank-2',
        query: 'query',
        documents: ['passage'],
      }),
    ).rejects.toThrow(/ZeroEntropy rerank request failed with HTTP 429 Too Many Requests: rate limited/u);
  });

  it('throws for malformed embed responses', async () => {
    const mockFetch = createJsonFetch({ results: [{ embedding: [0.1, 'not-a-number'] }] });
    const client = createClient(mockFetch);

    await expect(
      client.embed({
        model: 'zembed-1',
        input: ['chunk'],
        inputType: 'document',
      }),
    ).rejects.toThrow(/Malformed ZeroEntropy embed response: expected results\[0\]\.embedding/u);
  });

  it('validates embed response count matches the input count', async () => {
    const mockFetch = createJsonFetch({ results: [{ embedding: [0.1, 0.2] }] });
    const client = createClient(mockFetch);

    await expect(
      client.embed({
        model: 'zembed-1',
        input: ['first chunk', 'second chunk'],
        inputType: 'document',
      }),
    ).rejects.toThrow(/embedding count mismatch: expected 2, received 1/u);
  });

  it('throws for malformed rerank responses', async () => {
    const mockFetch = createJsonFetch({ results: [{ index: 0, relevance_score: 'high' }] });
    const client = createClient(mockFetch);

    await expect(
      client.rerank({
        model: 'zerank-2',
        query: 'query',
        documents: ['passage'],
      }),
    ).rejects.toThrow(/Malformed ZeroEntropy rerank response: expected results\[0\]\.relevance_score/u);
  });

  it('aborts requests when the configured timeout elapses', async () => {
    const fetchImplementation: typeof fetch = (_input, init) => {
      const signal = init?.signal;

      if (signal === undefined) {
        return Promise.reject(new Error('expected an abort signal'));
      }

      return new Promise<Response>((_resolve, reject) => {
        const rejectWithAbortReason = (): void => {
          const reason = signal.reason;
          reject(reason instanceof Error ? reason : new Error('aborted'));
        };

        if (signal.aborted) {
          rejectWithAbortReason();
          return;
        }

        signal.addEventListener('abort', rejectWithAbortReason, { once: true });
      });
    };
    const client = new ZeroEntropyClient({
      apiKey: 'test-key',
      baseUrl: 'https://api.zeroentropy.dev/v1',
      fetchImplementation,
      timeoutMs: 1,
    });

    await expect(
      client.rerank({
        model: 'zerank-2',
        query: 'query',
        documents: ['passage'],
      }),
    ).rejects.toThrow(/ZeroEntropy request timed out after 1ms/u);
  });
});

function createClient(mockFetch: MockFetch, options: { baseUrl?: string } = {}): ZeroEntropyClient {
  return new ZeroEntropyClient({
    apiKey: 'test-key',
    baseUrl: options.baseUrl ?? 'https://api.zeroentropy.dev/v1',
    fetchImplementation: mockFetch.fetchImplementation,
  });
}

function createJsonFetch(body: unknown, init: ResponseInit = {}): MockFetch {
  const calls: FetchCall[] = [];
  const fetchImplementation: typeof fetch = (input, requestInit) => {
    calls.push({ input, init: requestInit });
    return Promise.resolve(jsonResponse(body, init));
  };

  return { fetchImplementation, calls };
}

function createTextFetch(body: string, init: ResponseInit): MockFetch {
  const calls: FetchCall[] = [];
  const fetchImplementation: typeof fetch = (input, requestInit) => {
    calls.push({ input, init: requestInit });
    return Promise.resolve(new Response(body, init));
  };

  return { fetchImplementation, calls };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function onlyCall(mockFetch: MockFetch): FetchCall {
  expect(mockFetch.calls).toHaveLength(1);

  const call = mockFetch.calls[0];

  if (call === undefined) {
    throw new Error('expected one fetch call');
  }

  return call;
}

function requireRequestInit(call: FetchCall): RequestInit {
  if (call.init === undefined) {
    throw new Error('expected fetch request init');
  }

  return call.init;
}

function readJsonRequestBody(requestInit: RequestInit): unknown {
  if (typeof requestInit.body !== 'string') {
    throw new Error('expected a string request body');
  }

  return JSON.parse(requestInit.body) as unknown;
}
