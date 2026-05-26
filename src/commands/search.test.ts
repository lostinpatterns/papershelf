import { describe, expect, it } from 'vitest';
import type { PapershelfConfig } from '../config.js';
import type { EmbedResponse, RerankResponse } from '../providers/zeroentropy.js';
import type { SearchCorpusOptions, SearchProvider } from '../search/search-corpus.js';
import type { OpenVectorStoreOptions, VectorStore } from '../storage/libsql-store.js';
import type { IndexedDocument, PapershelfPaths, SearchCandidate, SearchResult } from '../types.js';
import { runSearchCommand, type SearchCommandDependencies } from './search.js';

describe('runSearchCommand', () => {
  it('loads config, opens an initialized store, runs search, formats output, and closes the store', async () => {
    const paths = createPaths('/repo');
    const config = createConfig();
    const provider = new MockSearchProvider();
    const store = new RecordingStore();
    const searchResult = createSearchResult();
    const records = createDependencyRecords();
    const dependencies = createDependencies({ paths, config, provider, store, records, searchResults: [searchResult] });

    await expect(
      runSearchCommand({
        context: { cwd: '/repo/subdir', env: { ZEROENTROPY_API_KEY: 'test-key' } },
        question: 'what is relevant?',
        format: 'json',
        dependencies,
      }),
    ).resolves.toEqual({ stdout: 'formatted json results: 1', exitCode: 0 });

    expect(records.resolvedCwds).toEqual(['/repo/subdir']);
    expect(records.loadedEnvs).toEqual([{ ZEROENTROPY_API_KEY: 'test-key' }]);
    expect(records.providerConfigs).toEqual([config]);
    expect(records.openStoreOptions).toEqual([{ paths, embeddingDimensions: 3 }]);
    expect(store.initialized).toBe(true);
    expect(store.closed).toBe(true);
    expect(records.searchOptions).toHaveLength(1);
    expect(records.searchOptions[0]).toMatchObject({ question: 'what is relevant?', config });
    expect(records.searchOptions[0]?.provider).toBe(provider);
    expect(records.searchOptions[0]?.store).toBe(store);
    expect(records.formatCalls).toEqual([{ results: [searchResult], format: 'json' }]);
  });

  it('closes the store when the search pipeline throws', async () => {
    const store = new RecordingStore();
    const dependencies = createDependencies({
      paths: createPaths('/repo'),
      config: createConfig(),
      provider: new MockSearchProvider(),
      store,
      records: createDependencyRecords(),
      searchError: new Error('search failed'),
    });

    await expect(
      runSearchCommand({
        context: { cwd: '/repo', env: { ZEROENTROPY_API_KEY: 'test-key' } },
        question: 'what is relevant?',
        format: 'text',
        dependencies,
      }),
    ).rejects.toThrow(/search failed/u);

    expect(store.initialized).toBe(true);
    expect(store.closed).toBe(true);
  });
});

type DependencyRecords = {
  resolvedCwds: string[];
  loadedEnvs: Readonly<NodeJS.ProcessEnv>[];
  providerConfigs: PapershelfConfig[];
  openStoreOptions: OpenVectorStoreOptions[];
  searchOptions: SearchCorpusOptions[];
  formatCalls: { results: readonly SearchResult[]; format: 'text' | 'json' }[];
};

function createDependencies(options: {
  paths: PapershelfPaths;
  config: PapershelfConfig;
  provider: SearchProvider;
  store: VectorStore;
  records: DependencyRecords;
  searchResults?: readonly SearchResult[];
  searchError?: Error;
}): Partial<SearchCommandDependencies> {
  return {
    resolvePaths: (cwd) => {
      options.records.resolvedCwds.push(cwd);
      return options.paths;
    },
    loadConfig: (env) => {
      options.records.loadedEnvs.push({ ...env });
      return options.config;
    },
    createProvider: (config) => {
      options.records.providerConfigs.push(config);
      return options.provider;
    },
    openStore: async (openStoreOptions) => {
      options.records.openStoreOptions.push(openStoreOptions);
      return options.store;
    },
    searchCorpus: async (searchOptions) => {
      options.records.searchOptions.push(searchOptions);

      if (options.searchError !== undefined) {
        throw options.searchError;
      }

      return options.searchResults ?? [];
    },
    formatSearchResults: (results, formatOptions) => {
      options.records.formatCalls.push({ results, format: formatOptions.format });
      return `formatted ${formatOptions.format} results: ${results.length}`;
    },
  };
}

function createDependencyRecords(): DependencyRecords {
  return {
    resolvedCwds: [],
    loadedEnvs: [],
    providerConfigs: [],
    openStoreOptions: [],
    searchOptions: [],
    formatCalls: [],
  };
}

class RecordingStore implements VectorStore {
  public initialized: boolean = false;
  public closed: boolean = false;

  public async initialize(): Promise<void> {
    this.initialized = true;
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

  public async search(): Promise<readonly SearchCandidate[]> {
    return [];
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

class MockSearchProvider implements SearchProvider {
  public async embed(): Promise<EmbedResponse> {
    return { embeddings: [] };
  }

  public async rerank(): Promise<RerankResponse> {
    return { results: [] };
  }
}

function createConfig(): PapershelfConfig {
  return {
    zeroEntropyApiKey: 'test-key',
    zeroEntropyBaseUrl: 'https://api.zeroentropy.dev/v1',
    embeddingModel: 'zembed-1',
    embeddingDimensions: 3,
    rerankModel: 'zerank-2',
    defaultCandidateLimit: 30,
    defaultResultLimit: 5,
  };
}

function createPaths(repoRoot: string): PapershelfPaths {
  return {
    repoRoot,
    papershelfDir: `${repoRoot}/.papershelf`,
    docsDir: `${repoRoot}/.papershelf/docs`,
    indexDir: `${repoRoot}/.papershelf/index`,
    bundledSkillPath: `${repoRoot}/skills/papershelf/SKILL.md`,
    installedSkillPath: `${repoRoot}/.agents/skills/papershelf/SKILL.md`,
  };
}

function createSearchResult(): SearchResult {
  return {
    docId: '.papershelf/docs/paper.md',
    chunkIndex: 0,
    text: 'Relevant passage.',
    distance: 0.1,
    relevanceScore: 0.9,
  };
}
