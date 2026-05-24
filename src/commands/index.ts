import { defaultChunkerOptions, textBoundaryChunkerVersion } from '../chunkers/text-boundaries.js';
import { loadConfig } from '../config.js';
import { indexCorpus } from '../indexing/index-corpus.js';
import { resolvePapershelfPaths } from '../paths.js';
import { ZeroEntropyClient } from '../providers/zeroentropy.js';
import { openVectorStore } from '../storage/pglite-store.js';
import type { CliResult, CommandContext } from '../types.js';

export type IndexCommandOptions = {
  context: CommandContext;
};

export async function runIndexCommand(options: IndexCommandOptions): Promise<CliResult> {
  const paths = resolvePapershelfPaths(options.context.cwd);
  const config = loadConfig(options.context.env);
  const embedder = new ZeroEntropyClient({
    apiKey: config.zeroEntropyApiKey,
    baseUrl: config.zeroEntropyBaseUrl,
  });
  const store = await openVectorStore({ paths, embeddingDimensions: config.embeddingDimensions });

  try {
    await store.initialize();

    return await indexCorpus({
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
