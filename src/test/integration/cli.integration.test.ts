import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../../cli.js';

const embeddingDimensions = 1280;

describe('papershelf CLI integration', () => {
  it('initializes, indexes, incrementally re-indexes, and searches a temp repo', async () => {
    const repoRoot = await createTemporaryRepo();
    const zeroEntropy = await startZeroEntropyServer();
    const context = {
      cwd: repoRoot,
      env: {
        ZEROENTROPY_API_KEY: 'test-key',
        ZEROENTROPY_BASE_URL: zeroEntropy.baseUrl,
      },
    };

    try {
      const initResult = await runCli(['init'], context);

      expect(initResult.exitCode).toBe(0);
      expect(initResult.stdout).toContain('Docs directory: .papershelf/docs (created)');
      expect(initResult.stdout).toContain('Agent skill: .agents/skills/papershelf/SKILL.md (created)');

      const docsStats = await stat(path.join(repoRoot, '.papershelf', 'docs'));

      expect(docsStats.isDirectory()).toBe(true);

      await writeFile(
        path.join(repoRoot, '.papershelf', 'docs', 'transformers.md'),
        '# Transformers\n\nTransformer models use attention to relate tokens in a sequence. Self-attention lets each token attend to other tokens.\n',
        'utf8',
      );
      await writeFile(
        path.join(repoRoot, '.papershelf', 'docs', 'storage.md'),
        '# Local vector storage\n\nlibSQL can store repository-local vector indexes. Native vector functions support cosine similarity search over embeddings.\n',
        'utf8',
      );

      await expect(runCli(['index'], context)).resolves.toEqual({
        stdout:
          'Indexed papershelf corpus.\n' +
          'Source files: 2\n' +
          'Unchanged documents: 0\n' +
          'Indexed documents: 2\n' +
          'Deleted documents: 0\n' +
          'Indexed chunks: 2',
        exitCode: 0,
      });

      const documentEmbedRecords = getEmbedRecords(zeroEntropy.records, 'document');

      expect(documentEmbedRecords).toHaveLength(2);
      expect(documentEmbedRecords.every((record) => record.authorization === 'Bearer test-key')).toBe(true);

      await expect(runCli(['index'], context)).resolves.toEqual({
        stdout:
          'Indexed papershelf corpus.\n' +
          'Source files: 2\n' +
          'Unchanged documents: 2\n' +
          'Indexed documents: 0\n' +
          'Deleted documents: 0\n' +
          'Indexed chunks: 0',
        exitCode: 0,
      });
      expect(getEmbedRecords(zeroEntropy.records, 'document')).toHaveLength(2);

      const searchResult = await runCli(['search', 'How are embeddings stored locally?', '--json'], context);

      expect(searchResult.exitCode).toBe(0);

      const searchOutput = parseSearchOutput(searchResult.stdout);
      const firstResult = searchOutput.results[0];
      expect(firstResult).toMatchObject({
        docId: '.papershelf/docs/storage.md',
        chunkIndex: 0,
        metadata: { heading: 'Local vector storage' },
      });
      expect(firstResult?.text).toContain('libSQL can store repository-local vector indexes.');
      expect(firstResult?.relevanceScore).toBeGreaterThan(0.9);
      expect(getEmbedRecords(zeroEntropy.records, 'query')).toHaveLength(1);
      expect(getRecordsByPath(zeroEntropy.records, '/v1/models/rerank')).toHaveLength(1);
    } finally {
      await zeroEntropy.close();
      await rm(repoRoot, { recursive: true, force: true });
    }
  }, 30_000);
});

type RecordedRequest = {
  path: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
};

type MockZeroEntropyServer = {
  baseUrl: string;
  records: RecordedRequest[];
  close(): Promise<void>;
};

type SearchOutput = {
  results: SearchJsonResult[];
};

type SearchJsonResult = {
  docId: string;
  chunkIndex: number;
  text: string;
  relevanceScore?: number;
  metadata?: {
    heading?: string;
  };
};

async function createTemporaryRepo(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'papershelf-integration-'));
  await mkdir(path.join(repoRoot, '.git'));

  return repoRoot;
}

async function startZeroEntropyServer(): Promise<MockZeroEntropyServer> {
  const records: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    void handleRequest(request, response, records).catch((error: unknown) => {
      writeJson(response, 500, { error: formatUnknownError(error) });
    });
  });

  await listen(server);

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Expected ZeroEntropy test server to listen on a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    records,
    close: async () => {
      await close(server);
    },
  };
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const rejectListen = (error: Error): void => {
      reject(error);
    };

    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolve();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  records: RecordedRequest[],
): Promise<void> {
  if (request.method !== 'POST') {
    writeJson(response, 405, { error: 'method not allowed' });
    return;
  }

  const body = requireRecord(await readJsonBody(request));
  const requestPath = request.url ?? '';

  records.push({
    path: requestPath,
    authorization: request.headers.authorization,
    body,
  });

  if (request.headers.authorization !== 'Bearer test-key') {
    writeJson(response, 401, { error: 'bad api key' });
    return;
  }

  switch (requestPath) {
    case '/v1/models/embed':
      writeJson(response, 200, createEmbedResponse(body));
      return;

    case '/v1/models/rerank':
      writeJson(response, 200, createRerankResponse(body));
      return;

    default:
      writeJson(response, 404, { error: `unknown route: ${requestPath}` });
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function createEmbedResponse(body: Record<string, unknown>): unknown {
  const input = readStringArray(body, 'input');
  const inputType = readString(body, 'input_type');

  return {
    results: input.map((text) => ({
      embedding: createEmbedding(text, inputType),
    })),
  };
}

function createRerankResponse(body: Record<string, unknown>): unknown {
  const query = readString(body, 'query');
  const documents = readStringArray(body, 'documents');

  return {
    results: documents
      .map((document, index) => ({
        index,
        relevance_score: scoreRerankDocument(query, document),
      }))
      .sort((left, right) => right.relevance_score - left.relevance_score),
  };
}

function createEmbedding(text: string, inputType: string): number[] {
  const embedding = Array.from({ length: embeddingDimensions }, () => 0);
  const topic = classifyText(text, inputType);

  switch (topic) {
    case 'storage':
      embedding[0] = 1;
      break;

    case 'attention':
      embedding[1] = 1;
      break;

    case 'other':
      embedding[2] = 1;
      break;
  }

  return embedding;
}

function scoreRerankDocument(query: string, document: string): number {
  return classifyText(query, 'query') === classifyText(document, 'document') ? 0.99 : 0.1;
}

type TextTopic = 'storage' | 'attention' | 'other';

function classifyText(text: string, inputType: string): TextTopic {
  const lowerText = text.toLowerCase();

  if (
    lowerText.includes('libsql') ||
    lowerText.includes('native vector') ||
    lowerText.includes('repository-local vector') ||
    (inputType === 'query' && lowerText.includes('stored locally'))
  ) {
    return 'storage';
  }

  if (lowerText.includes('attention') || lowerText.includes('tokens') || lowerText.includes('transformer')) {
    return 'attention';
  }

  return 'other';
}

function getEmbedRecords(records: readonly RecordedRequest[], inputType: 'document' | 'query'): RecordedRequest[] {
  return getRecordsByPath(records, '/v1/models/embed').filter((record) => record.body['input_type'] === inputType);
}

function getRecordsByPath(records: readonly RecordedRequest[], requestPath: string): RecordedRequest[] {
  return records.filter((record) => record.path === requestPath);
}

function parseSearchOutput(stdout: string | undefined): SearchOutput {
  if (stdout === undefined) {
    throw new Error('Expected search command to write stdout.');
  }

  return JSON.parse(stdout) as SearchOutput;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];

  if (typeof value !== 'string') {
    throw new Error(`Expected ${key} to be a string.`);
  }

  return value;
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Expected ${key} to be an array of strings.`);
  }

  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Expected request body to be a JSON object.');
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
