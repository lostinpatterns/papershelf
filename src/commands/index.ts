import { defaultChunkerOptions, textBoundaryChunkerVersion } from '../chunkers/text-boundaries.js';
import { loadConfig, type PapershelfConfig } from '../config.js';
import { indexCorpus, type IndexCorpusOptions } from '../indexing/index-corpus.js';
import type { DocumentEmbedder } from '../indexing/index-document.js';
import { resolvePapershelfPaths } from '../paths.js';
import { ZeroEntropyClient } from '../providers/zeroentropy.js';
import { openVectorStore, type OpenVectorStoreOptions, type VectorStore } from '../storage/pglite-store.js';
import type { CliResult, CommandContext, PapershelfPaths } from '../types.js';

export type IndexCommandDependencies = {
  resolvePaths(cwd: string): PapershelfPaths;
  loadConfig(env: Readonly<NodeJS.ProcessEnv>): PapershelfConfig;
  createEmbedder(config: PapershelfConfig): DocumentEmbedder;
  openStore(options: OpenVectorStoreOptions): Promise<VectorStore>;
  indexCorpus(options: IndexCorpusOptions): Promise<CliResult>;
};

export type IndexCommandOptions = {
  context: CommandContext;
  rebuild?: boolean;
  dependencies?: Partial<IndexCommandDependencies>;
};

const defaultIndexCommandDependencies: IndexCommandDependencies = {
  resolvePaths: resolvePapershelfPaths,
  loadConfig,
  createEmbedder: (config) =>
    new ZeroEntropyClient({
      apiKey: config.zeroEntropyApiKey,
      baseUrl: config.zeroEntropyBaseUrl,
    }),
  openStore: openVectorStore,
  indexCorpus,
};

export async function runIndexCommand(options: IndexCommandOptions): Promise<CliResult> {
  const dependencies = {
    ...defaultIndexCommandDependencies,
    ...(options.dependencies ?? {}),
  };
  const paths = dependencies.resolvePaths(options.context.cwd);
  const config = dependencies.loadConfig(options.context.env);
  const embedder = dependencies.createEmbedder(config);
  const store = await dependencies.openStore({
    paths,
    embeddingDimensions: config.embeddingDimensions,
    rebuild: options.rebuild === true,
  });

  try {
    await store.initialize();

    return await dependencies.indexCorpus({
      paths,
      config,
      chunkerOptions: defaultChunkerOptions,
      chunkerVersion: textBoundaryChunkerVersion,
      embedder,
      store,
    });
  } finally {
    await store.close();
  }
}
