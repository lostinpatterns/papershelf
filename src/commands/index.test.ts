import { describe, expect, it } from 'vitest';
import type { PapershelfConfig } from '../config.js';
import type { IndexCorpusOptions } from '../indexing/index-corpus.js';
import type { DocumentEmbedder } from '../indexing/index-document.js';
import type { EmbedResponse } from '../providers/zeroentropy.js';
import type { OpenVectorStoreOptions, VectorStore } from '../storage/pglite-store.js';
import type { IndexedDocument, PapershelfPaths, SearchCandidate } from '../types.js';
import { runIndexCommand, type IndexCommandDependencies } from './index.js';

describe('runIndexCommand', () => {
  it('loads config, opens an initialized store, indexes, and closes the store', async () => {
    const paths = createPaths('/repo');
    const config = createConfig();
    const embedder = new MockEmbedder();
    const store = new RecordingStore();
    const records = createDependencyRecords();
    const dependencies = createDependencies({ paths, config, embedder, store, records });

    await expect(
      runIndexCommand({
        context: { cwd: '/repo/subdir', env: { ZEROENTROPY_API_KEY: 'test-key' } },
        dependencies,
      }),
    ).resolves.toEqual({ stdout: 'indexed', exitCode: 0 });

    expect(records.resolvedCwds).toEqual(['/repo/subdir']);
    expect(records.loadedEnvs).toEqual([{ ZEROENTROPY_API_KEY: 'test-key' }]);
    expect(records.embedderConfigs).toEqual([config]);
    expect(records.openStoreOptions).toEqual([{ paths, embeddingDimensions: 3, rebuild: false }]);
    expect(store.initialized).toBe(true);
    expect(store.closed).toBe(true);
    expect(records.indexOptions).toHaveLength(1);
    expect(records.indexOptions[0]).toMatchObject({ paths, config, embedder, store });
  });

  it('passes rebuild through to storage opening', async () => {
    const paths = createPaths('/repo');
    const config = createConfig();
    const records = createDependencyRecords();
    const dependencies = createDependencies({
      paths,
      config,
      embedder: new MockEmbedder(),
      store: new RecordingStore(),
      records,
    });

    await runIndexCommand({
      context: { cwd: '/repo', env: { ZEROENTROPY_API_KEY: 'test-key' } },
      rebuild: true,
      dependencies,
    });

    expect(records.openStoreOptions).toEqual([{ paths, embeddingDimensions: 3, rebuild: true }]);
  });

  it('closes the store when indexing throws', async () => {
    const store = new RecordingStore();
    const dependencies = createDependencies({
      paths: createPaths('/repo'),
      config: createConfig(),
      embedder: new MockEmbedder(),
      store,
      records: createDependencyRecords(),
      indexError: new Error('index failed'),
    });

    await expect(
      runIndexCommand({
        context: { cwd: '/repo', env: { ZEROENTROPY_API_KEY: 'test-key' } },
        dependencies,
      }),
    ).rejects.toThrow(/index failed/u);

    expect(store.initialized).toBe(true);
    expect(store.closed).toBe(true);
  });
});

type DependencyRecords = {
  resolvedCwds: string[];
  loadedEnvs: Readonly<NodeJS.ProcessEnv>[];
  embedderConfigs: PapershelfConfig[];
  openStoreOptions: OpenVectorStoreOptions[];
  indexOptions: IndexCorpusOptions[];
};

function createDependencies(options: {
  paths: PapershelfPaths;
  config: PapershelfConfig;
  embedder: DocumentEmbedder;
  store: VectorStore;
  records: DependencyRecords;
  indexError?: Error;
}): Partial<IndexCommandDependencies> {
  return {
    resolvePaths: (cwd) => {
      options.records.resolvedCwds.push(cwd);
      return options.paths;
    },
    loadConfig: (env) => {
      options.records.loadedEnvs.push({ ...env });
      return options.config;
    },
    createEmbedder: (config) => {
      options.records.embedderConfigs.push(config);
      return options.embedder;
    },
    openStore: async (openStoreOptions) => {
      options.records.openStoreOptions.push(openStoreOptions);
      return options.store;
    },
    indexCorpus: async (indexOptions) => {
      options.records.indexOptions.push(indexOptions);

      if (options.indexError !== undefined) {
        throw options.indexError;
      }

      return { stdout: 'indexed', exitCode: 0 };
    },
  };
}

function createDependencyRecords(): DependencyRecords {
  return {
    resolvedCwds: [],
    loadedEnvs: [],
    embedderConfigs: [],
    openStoreOptions: [],
    indexOptions: [],
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

class MockEmbedder implements DocumentEmbedder {
  public async embed(): Promise<EmbedResponse> {
    return { embeddings: [] };
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
