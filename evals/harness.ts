import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { defaultChunkerOptions, textBoundaryChunkerVersion } from '../src/chunkers/text-boundaries.js';
import { defaultEmbeddingDimensions, defaultZeroEntropyBaseUrl, type PapershelfConfig } from '../src/config.js';
import { indexCorpus } from '../src/indexing/index-corpus.js';
import type { DocumentEmbedder } from '../src/indexing/index-document.js';
import type { EmbedRequest, EmbedResponse, RerankRequest, RerankResponse } from '../src/providers/zeroentropy.js';
import { ZeroEntropyClient } from '../src/providers/zeroentropy.js';
import { formatSearchResults } from '../src/search/format.js';
import { searchCorpus, type SearchProvider } from '../src/search/search-corpus.js';
import { openVectorStore } from '../src/storage/pglite-store.js';
import type { PapershelfPaths } from '../src/types.js';
import { createHarness, type Harness, type JsonValue, type SimpleToolCallRecord } from 'vitest-evals/harness';
import { executeWithReplay, normalizeReplayMetadata } from 'vitest-evals/replay';

export type PapershelfEvalDocument = {
  path: string;
  text: string;
};

export type PapershelfEvalInput = {
  name: string;
  documents: PapershelfEvalDocument[];
  query: string;
  expected: {
    topDocId: string;
    quote: string;
  };
};

export type PapershelfEvalResult = {
  docId: string;
  chunkIndex: number;
  text: string;
  snippet: string;
  distance: number | null;
  relevanceScore: number | null;
  metadata: Record<string, JsonValue>;
};

export type PapershelfEvalOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
  results: PapershelfEvalResult[];
};

type ReplayContext = {
  apiKey: string | undefined;
  baseUrl: string;
  signal: AbortSignal | undefined;
};

type ReplayEmbedArgs = {
  [key: string]: JsonValue;
  model: string;
  input: string[];
  inputType: string;
  dimensions: number;
};

type ReplayEmbedResult = {
  [key: string]: JsonValue;
  embeddings: number[][];
};

type ReplayRerankArgs = {
  [key: string]: JsonValue;
  model: string;
  query: string;
  documents: string[];
};

type ReplayRerankResultEntry = {
  [key: string]: JsonValue;
  index: number;
  relevanceScore: number;
};

type ReplayRerankResult = {
  [key: string]: JsonValue;
  results: ReplayRerankResultEntry[];
};

type FormattedSearchOutput = {
  results: FormattedSearchResult[];
};

type FormattedSearchResult = {
  docId: string;
  chunkIndex: number;
  text: string;
  snippet: string;
  distance: number;
  relevanceScore?: number;
  metadata?: Record<string, JsonValue>;
};

const evalCandidateLimit = 5;
const replayVersion = 'papershelf-semantic-search-v1';
const replayOnlyApiKey = 'eval-replay-only';

export const papershelfHarness: Harness<PapershelfEvalInput, PapershelfEvalOutput> = createHarness<
  PapershelfEvalInput,
  PapershelfEvalOutput
>({
  name: 'papershelf-search',
  run: async ({ input, signal }) => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'papershelf-eval-'));

    try {
      const paths = createEvalPaths(repoRoot);
      await writeEvalDocuments(paths, input.documents);

      const config = createEvalConfig(input.documents.length);
      const provider = new ReplayZeroEntropyProvider({
        apiKey: config.zeroEntropyApiKey === replayOnlyApiKey ? undefined : config.zeroEntropyApiKey,
        baseUrl: config.zeroEntropyBaseUrl,
        signal,
      });
      const store = await openVectorStore({ paths, embeddingDimensions: config.embeddingDimensions, rebuild: true });

      try {
        await store.initialize();
        await indexCorpus({
          paths,
          config,
          chunkerOptions: defaultChunkerOptions,
          chunkerVersion: textBoundaryChunkerVersion,
          embedder: provider,
          store,
        });

        const results = await searchCorpus({
          question: input.query,
          config,
          provider,
          store,
        });
        const stdout = formatSearchResults(results, { format: 'json' });
        const output: PapershelfEvalOutput = {
          exitCode: 0,
          stdout,
          stderr: '',
          results: parseJsonSearchResults(stdout),
        };

        return {
          output,
          toolCalls: provider.toolCalls,
          usage: {
            provider: 'zeroentropy',
            model: `${config.embeddingModel}+${config.rerankModel}`,
            toolCalls: provider.toolCalls.length,
          },
          artifacts: {
            expectedTopDocId: input.expected.topDocId,
            expectedQuote: input.expected.quote,
          },
        };
      } finally {
        await store.close();
      }
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  },
});

class ReplayZeroEntropyProvider implements DocumentEmbedder, SearchProvider {
  public readonly toolCalls: SimpleToolCallRecord[] = [];
  private readonly context: ReplayContext;

  public constructor(context: ReplayContext) {
    this.context = context;
  }

  public async embed(request: EmbedRequest): Promise<EmbedResponse> {
    const args: ReplayEmbedArgs = {
      model: request.model,
      input: [...request.input],
      inputType: request.inputType,
      dimensions: request.dimensions,
    };
    const replayed = await executeWithReplay<ReplayEmbedArgs, ReplayEmbedResult, ReplayContext>({
      toolName: 'zeroentropy.embed',
      args,
      context: this.context,
      execute: callLiveEmbed,
      replay: { version: replayVersion },
    });

    this.toolCalls.push(
      createToolCall({
        name: 'zeroentropy.embed',
        arguments: {
          model: args.model,
          inputType: args.inputType,
          inputCount: args.input.length,
          dimensions: args.dimensions,
        },
        result: {
          embeddingCount: replayed.result.embeddings.length,
          dimensions: replayed.result.embeddings[0]?.length ?? 0,
        },
        replay: replayed.replay,
      }),
    );

    return { embeddings: replayed.result.embeddings };
  }

  public async rerank(request: RerankRequest): Promise<RerankResponse> {
    const args: ReplayRerankArgs = {
      model: request.model,
      query: request.query,
      documents: [...request.documents],
    };
    const replayed = await executeWithReplay<ReplayRerankArgs, ReplayRerankResult, ReplayContext>({
      toolName: 'zeroentropy.rerank',
      args,
      context: this.context,
      execute: callLiveRerank,
      replay: { version: replayVersion },
    });

    this.toolCalls.push(
      createToolCall({
        name: 'zeroentropy.rerank',
        arguments: {
          model: args.model,
          query: args.query,
          documentCount: args.documents.length,
        },
        result: {
          resultCount: replayed.result.results.length,
        },
        replay: replayed.replay,
      }),
    );

    return { results: replayed.result.results };
  }
}

async function callLiveEmbed(args: ReplayEmbedArgs, context: ReplayContext): Promise<ReplayEmbedResult> {
  const client = createLiveZeroEntropyClient(context);
  const request: EmbedRequest = {
    model: args.model as EmbedRequest['model'],
    input: args.input,
    inputType: args.inputType as EmbedRequest['inputType'],
    dimensions: args.dimensions,
  };

  if (context.signal !== undefined) {
    request.signal = context.signal;
  }

  const response = await client.embed(request);

  return {
    embeddings: response.embeddings.map((embedding) => [...embedding]),
  };
}

async function callLiveRerank(args: ReplayRerankArgs, context: ReplayContext): Promise<ReplayRerankResult> {
  const client = createLiveZeroEntropyClient(context);
  const request: RerankRequest = {
    model: args.model as RerankRequest['model'],
    query: args.query,
    documents: args.documents,
  };

  if (context.signal !== undefined) {
    request.signal = context.signal;
  }

  const response = await client.rerank(request);

  return {
    results: response.results.map((result) => ({
      index: result.index,
      relevanceScore: result.relevanceScore,
    })),
  };
}

function createLiveZeroEntropyClient(context: ReplayContext): ZeroEntropyClient {
  const apiKey = context.apiKey?.trim();

  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error('Missing ZEROENTROPY_API_KEY for recording missing papershelf eval replay data.');
  }

  return new ZeroEntropyClient({
    apiKey,
    baseUrl: context.baseUrl,
    timeoutMs: 30_000,
  });
}

function createToolCall(options: {
  name: string;
  arguments: Record<string, JsonValue>;
  result: Record<string, JsonValue>;
  replay: { status: 'recorded' | 'replayed'; recordingPath: string; cacheKey: string } | undefined;
}): SimpleToolCallRecord {
  const call: SimpleToolCallRecord = {
    name: options.name,
    arguments: options.arguments,
    result: options.result,
  };
  const metadata = normalizeReplayMetadata(options.replay);

  if (metadata !== undefined) {
    call.metadata = metadata;
  }

  return call;
}

function createEvalConfig(documentCount: number): PapershelfConfig {
  const apiKey = process.env['ZEROENTROPY_API_KEY']?.trim();
  const baseUrl = process.env['ZEROENTROPY_BASE_URL']?.trim();

  return {
    zeroEntropyApiKey: apiKey === undefined || apiKey.length === 0 ? replayOnlyApiKey : apiKey,
    zeroEntropyBaseUrl: baseUrl === undefined || baseUrl.length === 0 ? defaultZeroEntropyBaseUrl : baseUrl,
    embeddingModel: 'zembed-1',
    embeddingDimensions: defaultEmbeddingDimensions,
    rerankModel: 'zerank-2',
    defaultCandidateLimit: Math.min(evalCandidateLimit, documentCount),
    defaultResultLimit: Math.min(evalCandidateLimit, documentCount),
  };
}

function createEvalPaths(repoRoot: string): PapershelfPaths {
  const papershelfDir = path.join(repoRoot, '.papershelf');

  return {
    repoRoot,
    papershelfDir,
    docsDir: path.join(papershelfDir, 'docs'),
    indexDir: path.join(papershelfDir, 'index'),
    bundledSkillPath: path.join(process.cwd(), 'skills', 'papershelf', 'SKILL.md'),
    installedSkillPath: path.join(repoRoot, '.agents', 'skills', 'papershelf', 'SKILL.md'),
  };
}

async function writeEvalDocuments(paths: PapershelfPaths, documents: readonly PapershelfEvalDocument[]): Promise<void> {
  await mkdir(paths.docsDir, { recursive: true });

  for (const document of documents) {
    const absolutePath = resolveDocumentPath(paths, document.path);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, document.text, 'utf8');
  }
}

function resolveDocumentPath(paths: PapershelfPaths, documentPath: string): string {
  const docsDir = path.resolve(paths.docsDir);
  const absolutePath = path.resolve(docsDir, documentPath);

  if (absolutePath !== docsDir && !absolutePath.startsWith(`${docsDir}${path.sep}`)) {
    throw new Error(`Eval document path must stay inside .papershelf/docs: ${documentPath}`);
  }

  return absolutePath;
}

function parseJsonSearchResults(stdout: string): PapershelfEvalResult[] {
  const parsed = JSON.parse(stdout) as FormattedSearchOutput;

  return parsed.results.map((result) => ({
    docId: result.docId,
    chunkIndex: result.chunkIndex,
    text: result.text,
    snippet: result.snippet,
    distance: result.distance,
    relevanceScore: result.relevanceScore ?? null,
    metadata: result.metadata ?? {},
  }));
}
