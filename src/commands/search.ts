import { loadConfig, type PapershelfConfig } from '../config.js';
import { resolvePapershelfPaths } from '../paths.js';
import { ZeroEntropyClient } from '../providers/zeroentropy.js';
import { formatSearchResults, type FormatSearchResultsOptions } from '../search/format.js';
import { searchCorpus, type SearchCorpusOptions, type SearchProvider } from '../search/search-corpus.js';
import { openVectorStore, type OpenVectorStoreOptions, type VectorStore } from '../storage/libsql-store.js';
import type { CliResult, CommandContext, PapershelfPaths, SearchOutputFormat, SearchResult } from '../types.js';

export type SearchCommandDependencies = {
  resolvePaths(cwd: string): PapershelfPaths;
  loadConfig(env: Readonly<NodeJS.ProcessEnv>): PapershelfConfig;
  createProvider(config: PapershelfConfig): SearchProvider;
  openStore(options: OpenVectorStoreOptions): Promise<VectorStore>;
  searchCorpus(options: SearchCorpusOptions): Promise<readonly SearchResult[]>;
  formatSearchResults(results: readonly SearchResult[], options: FormatSearchResultsOptions): string;
};

export type SearchCommandOptions = {
  context: CommandContext;
  question: string;
  format: SearchOutputFormat;
  dependencies?: Partial<SearchCommandDependencies>;
};

const defaultSearchCommandDependencies: SearchCommandDependencies = {
  resolvePaths: resolvePapershelfPaths,
  loadConfig,
  createProvider: (config) =>
    new ZeroEntropyClient({
      apiKey: config.zeroEntropyApiKey,
      baseUrl: config.zeroEntropyBaseUrl,
    }),
  openStore: openVectorStore,
  searchCorpus,
  formatSearchResults,
};

export async function runSearchCommand(options: SearchCommandOptions): Promise<CliResult> {
  const dependencies = {
    ...defaultSearchCommandDependencies,
    ...(options.dependencies ?? {}),
  };
  const paths = dependencies.resolvePaths(options.context.cwd);
  const config = dependencies.loadConfig(options.context.env);
  const provider = dependencies.createProvider(config);
  const store = await dependencies.openStore({ paths, embeddingDimensions: config.embeddingDimensions });

  try {
    await store.initialize();

    const results = await dependencies.searchCorpus({
      question: options.question,
      config,
      provider,
      store,
    });

    return {
      stdout: dependencies.formatSearchResults(results, { format: options.format }),
      exitCode: 0,
    };
  } finally {
    await store.close();
  }
}
