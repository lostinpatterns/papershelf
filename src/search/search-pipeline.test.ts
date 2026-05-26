import { describe, expect, it } from 'vitest';
import type { PapershelfConfig } from '../config.js';
import type { EmbedRequest, EmbedResponse, RerankRequest, RerankResponse } from '../providers/zeroentropy.js';
import type { VectorSearchOptions, VectorStore } from '../storage/libsql-store.js';
import type { IndexedDocument, SearchCandidate } from '../types.js';
import { formatSearchResults } from './format.js';
import { applyReranker, type Reranker } from './rerank.js';
import { searchCorpus, type SearchProvider } from './search-corpus.js';
import { vectorSearch } from './vector-search.js';

describe('vectorSearch', () => {
  it('forwards the query embedding and candidate limit to the vector store', async () => {
    const store = new RecordingSearchStore([]);

    await expect(vectorSearch({ store, queryEmbedding: [1, 2, 3], limit: 30 })).resolves.toEqual([]);

    expect(store.searchCalls).toEqual([{ embedding: [1, 2, 3], limit: 30 }]);
  });
});

describe('applyReranker', () => {
  it('sends candidate texts to the reranker, orders by relevance score, and limits results', async () => {
    const candidates = [
      createCandidate(0, 'alpha passage'),
      createCandidate(1, 'beta passage'),
      createCandidate(2, 'gamma passage'),
    ];
    const reranker = new RecordingReranker({
      results: [
        { index: 0, relevanceScore: 0.2 },
        { index: 2, relevanceScore: 0.9 },
        { index: 1, relevanceScore: 0.4 },
      ],
    });

    await expect(
      applyReranker({
        client: reranker,
        rerankModel: 'zerank-2',
        query: 'which passage is relevant?',
        candidates,
        candidateLimit: 3,
        resultLimit: 2,
      }),
    ).resolves.toEqual([
      { ...candidates[2], relevanceScore: 0.9 },
      { ...candidates[1], relevanceScore: 0.4 },
    ]);

    expect(reranker.calls).toEqual([
      {
        model: 'zerank-2',
        query: 'which passage is relevant?',
        documents: ['alpha passage', 'beta passage', 'gamma passage'],
      },
    ]);
  });

  const failOpenCases: readonly [string, Error][] = [
    ['timeout', new Error('ZeroEntropy request timed out after 1ms.')],
    ['network', new TypeError('fetch failed')],
    ['auth', new Error('ZeroEntropy rerank request failed with HTTP 401 Unauthorized: bad api key')],
    ['non-2xx', new Error('ZeroEntropy rerank request failed with HTTP 429 Too Many Requests: rate limited')],
  ];

  for (const [label, error] of failOpenCases) {
    it(`fails open to embedding-order candidates on ${label} rerank errors`, async () => {
      const candidates = [
        createCandidate(0, 'alpha passage'),
        createCandidate(1, 'beta passage'),
        createCandidate(2, 'gamma passage'),
      ];
      const reranker = new ThrowingReranker(error);

      await expect(
        applyReranker({
          client: reranker,
          rerankModel: 'zerank-2',
          query: 'query',
          candidates,
          candidateLimit: 3,
          resultLimit: 2,
        }),
      ).resolves.toEqual([candidates[0], candidates[1]]);
    });
  }
});

describe('searchCorpus', () => {
  it('embeds the query, retrieves vector candidates, reranks them, and returns the result limit', async () => {
    const provider = new RecordingSearchProvider({
      embedResponse: { embeddings: [[0.2, 0.1, 0]] },
      rerankResponse: {
        results: [
          { index: 1, relevanceScore: 0.8 },
          { index: 0, relevanceScore: 0.3 },
        ],
      },
    });
    const store = new RecordingSearchStore([
      createCandidate(0, 'alpha passage'),
      createCandidate(1, 'beta passage'),
      createCandidate(2, 'gamma passage'),
    ]);

    await expect(
      searchCorpus({
        question: '  how does the method work?  ',
        config: createConfig({ defaultCandidateLimit: 2, defaultResultLimit: 1 }),
        provider,
        store,
      }),
    ).resolves.toEqual([{ ...createCandidate(1, 'beta passage'), relevanceScore: 0.8 }]);

    expect(provider.embedCalls).toEqual([
      {
        model: 'zembed-1',
        input: ['how does the method work?'],
        inputType: 'query',
        dimensions: 3,
      },
    ]);
    expect(store.searchCalls).toEqual([{ embedding: [0.2, 0.1, 0], limit: 2 }]);
    expect(provider.rerankCalls).toEqual([
      {
        model: 'zerank-2',
        query: 'how does the method work?',
        documents: ['alpha passage', 'beta passage'],
      },
    ]);
  });
});

describe('formatSearchResults', () => {
  it('formats text results with source, chunk, score, distance, metadata, and snippet', () => {
    const text = formatSearchResults(
      [
        {
          ...createCandidate(2, 'First line.\n\nSecond line with more detail.', {
            heading: 'Findings',
            section: 'Paper > Findings',
            page: 4,
            startLine: 10,
            endLine: 12,
          }),
          relevanceScore: 0.98765,
          distance: 0.123456,
        },
      ],
      { format: 'text' },
    );

    expect(text).toContain('[1] Source: .papershelf/docs/doc-2.md');
    expect(text).toContain('Chunk: 2');
    expect(text).toContain('Distance: 0.1235');
    expect(text).toContain('Relevance score: 0.9877');
    expect(text).toContain('Heading: Findings');
    expect(text).toContain('Section: Paper > Findings');
    expect(text).toContain('Page: 4');
    expect(text).toContain('Lines: 10-12');
    expect(text).toContain('Snippet:\n  First line. Second line with more detail.');
  });

  it('formats JSON results as parseable agent-facing records', () => {
    const result = {
      ...createCandidate(0, 'A passage with useful evidence.', { heading: 'Intro' }),
      relevanceScore: 0.5,
    };

    expect(JSON.parse(formatSearchResults([result], { format: 'json' }))).toEqual({
      results: [
        {
          docId: '.papershelf/docs/doc-0.md',
          chunkIndex: 0,
          text: 'A passage with useful evidence.',
          snippet: 'A passage with useful evidence.',
          distance: 0,
          relevanceScore: 0.5,
          metadata: { heading: 'Intro' },
        },
      ],
    });
  });
});

class RecordingSearchStore implements VectorStore {
  public readonly searchCalls: VectorSearchOptions[] = [];
  private readonly candidates: readonly SearchCandidate[];

  public constructor(candidates: readonly SearchCandidate[]) {
    this.candidates = candidates;
  }

  public async initialize(): Promise<void> {
    return undefined;
  }

  public async listDocuments(): Promise<readonly IndexedDocument[]> {
    return [];
  }

  public async deleteDocument(): Promise<void> {
    return undefined;
  }

  public async upsertDocument(): Promise<void> {
    return undefined;
  }

  public async search(options: VectorSearchOptions): Promise<readonly SearchCandidate[]> {
    this.searchCalls.push({ embedding: [...options.embedding], limit: options.limit });

    return this.candidates.slice(0, options.limit);
  }

  public async close(): Promise<void> {
    return undefined;
  }
}

class RecordingReranker implements Reranker {
  public readonly calls: RerankRequest[] = [];
  private readonly response: RerankResponse;

  public constructor(response: RerankResponse) {
    this.response = response;
  }

  public async rerank(request: RerankRequest): Promise<RerankResponse> {
    this.calls.push(request);

    return this.response;
  }
}

class ThrowingReranker implements Reranker {
  private readonly error: Error;

  public constructor(error: Error) {
    this.error = error;
  }

  public async rerank(): Promise<RerankResponse> {
    throw this.error;
  }
}

class RecordingSearchProvider implements SearchProvider {
  public readonly embedCalls: EmbedRequest[] = [];
  public readonly rerankCalls: RerankRequest[] = [];
  private readonly embedResponse: EmbedResponse;
  private readonly rerankResponse: RerankResponse;

  public constructor(options: { embedResponse: EmbedResponse; rerankResponse: RerankResponse }) {
    this.embedResponse = options.embedResponse;
    this.rerankResponse = options.rerankResponse;
  }

  public async embed(request: EmbedRequest): Promise<EmbedResponse> {
    this.embedCalls.push(request);

    return this.embedResponse;
  }

  public async rerank(request: RerankRequest): Promise<RerankResponse> {
    this.rerankCalls.push(request);

    return this.rerankResponse;
  }
}

function createConfig(overrides: Partial<PapershelfConfig> = {}): PapershelfConfig {
  return {
    zeroEntropyApiKey: 'test-key',
    zeroEntropyBaseUrl: 'https://api.zeroentropy.dev/v1',
    embeddingModel: 'zembed-1',
    embeddingDimensions: 3,
    rerankModel: 'zerank-2',
    defaultCandidateLimit: 30,
    defaultResultLimit: 5,
    ...overrides,
  };
}

function createCandidate(index: number, text: string, metadata?: SearchCandidate['metadata']): SearchCandidate {
  const candidate: SearchCandidate = {
    docId: `.papershelf/docs/doc-${index}.md`,
    chunkIndex: index,
    text,
    distance: index / 10,
  };

  if (metadata !== undefined) {
    candidate.metadata = metadata;
  }

  return candidate;
}
