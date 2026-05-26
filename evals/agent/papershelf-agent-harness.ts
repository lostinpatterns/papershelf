import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, type Harness, type SimpleToolCallRecord } from 'vitest-evals/harness';

export type PapershelfAgentEvalDocument = {
  path: string;
  text: string;
};

export type PapershelfAgentEvalInput = {
  name: string;
  prompt: string;
  documents: PapershelfAgentEvalDocument[];
};

type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type ProcessOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
};

type PiJsonEvent = Record<string, unknown> & {
  type?: unknown;
};

type PendingToolCall = {
  name: string;
  arguments: unknown;
};

type MockZeroEntropyServer = {
  baseUrl: string;
  close(): Promise<void>;
};

type EmbedRequestBody = {
  input: string[];
  dimensions: number;
};

type RerankRequestBody = {
  query: string;
  documents: string[];
};

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const distCliPath = path.join(repoRoot, 'dist', 'cli.js');
const evalApiKey = 'papershelf-agent-eval-key';
const defaultPiTimeoutMs = 120_000;
const commandTimeoutMs = 60_000;

let cliBuildPromise: Promise<void> | undefined;

export const papershelfAgentHarness: Harness<PapershelfAgentEvalInput, string> = createHarness<
  PapershelfAgentEvalInput,
  string
>({
  name: 'papershelf-skill-agent',
  run: async ({ input, signal }) => {
    await ensureCliBuilt(signal);

    const cwd = await mkdtemp(path.join(tmpdir(), 'papershelf-agent-eval-'));
    const mockServer = await startMockZeroEntropyServer();

    try {
      await prepareFixtureRepo(cwd, input.documents, mockServer.baseUrl, signal);

      const piResult = await runPiAgent(cwd, input.prompt, mockServer.baseUrl, signal);
      const events = parsePiJsonEvents(piResult.stdout);
      const toolCalls = extractToolCalls(events);
      const finalText = extractFinalAssistantText(events);
      const errors = piResult.exitCode === 0 ? [] : [createProcessError('pi', piResult)];

      return {
        output: finalText,
        toolCalls,
        usage: {
          provider: 'pi',
          model: process.env['PAPERSHELF_AGENT_EVAL_MODEL'] ?? 'default',
          toolCalls: toolCalls.length,
        },
        artifacts: {
          cwd,
          eventCount: events.length,
          piExitCode: piResult.exitCode,
          piStderr: piResult.stderr,
          nonJsonStdout: collectNonJsonLines(piResult.stdout),
        },
        errors,
      };
    } finally {
      await mockServer.close();
      await rm(cwd, { recursive: true, force: true });
    }
  },
});

async function ensureCliBuilt(signal: AbortSignal | undefined): Promise<void> {
  cliBuildPromise ??= (async () => {
    const result = await runProcess('pnpm', ['build'], {
      cwd: repoRoot,
      timeoutMs: commandTimeoutMs,
      signal,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to build Papershelf CLI before agent eval.\n${formatProcessResult(result)}`);
    }
  })();

  await cliBuildPromise;
}

async function prepareFixtureRepo(
  cwd: string,
  documents: readonly PapershelfAgentEvalDocument[],
  zeroEntropyBaseUrl: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  await writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({ name: 'papershelf-agent-eval-fixture', private: true, packageManager: 'pnpm@10.30.3' }, null, 2),
    'utf8',
  );
  await installLocalPapershelfBin(cwd);

  const env = createPapershelfEnv(zeroEntropyBaseUrl, cwd);
  const initResult = await runProcess('papershelf', ['init'], {
    cwd,
    env,
    timeoutMs: commandTimeoutMs,
    signal,
  });

  if (initResult.exitCode !== 0) {
    throw new Error(`Failed to initialize Papershelf fixture.\n${formatProcessResult(initResult)}`);
  }

  await writeEvalDocuments(cwd, documents);

  const indexResult = await runProcess('papershelf', ['index', '--rebuild'], {
    cwd,
    env,
    timeoutMs: commandTimeoutMs,
    signal,
  });

  if (indexResult.exitCode !== 0) {
    throw new Error(`Failed to index Papershelf fixture.\n${formatProcessResult(indexResult)}`);
  }
}

async function installLocalPapershelfBin(cwd: string): Promise<void> {
  const binDir = path.join(cwd, 'node_modules', '.bin');
  const binPath = path.join(binDir, 'papershelf');

  await mkdir(binDir, { recursive: true });
  await writeFile(binPath, `#!/usr/bin/env sh\nexec node ${JSON.stringify(distCliPath)} "$@"\n`, {
    encoding: 'utf8',
    mode: 0o755,
  });
}

async function writeEvalDocuments(cwd: string, documents: readonly PapershelfAgentEvalDocument[]): Promise<void> {
  const docsDir = path.join(cwd, '.papershelf', 'docs');

  for (const document of documents) {
    const absolutePath = resolveDocumentPath(docsDir, document.path);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, document.text, 'utf8');
  }
}

function resolveDocumentPath(docsDir: string, documentPath: string): string {
  const resolvedDocsDir = path.resolve(docsDir);
  const absolutePath = path.resolve(resolvedDocsDir, documentPath);

  if (absolutePath !== resolvedDocsDir && !absolutePath.startsWith(`${resolvedDocsDir}${path.sep}`)) {
    throw new Error(`Eval document path must stay inside .papershelf/docs: ${documentPath}`);
  }

  return absolutePath;
}

async function runPiAgent(
  cwd: string,
  prompt: string,
  zeroEntropyBaseUrl: string,
  signal: AbortSignal | undefined,
): Promise<ProcessResult> {
  const args = [
    '--mode',
    'json',
    '--print',
    '--no-session',
    '--offline',
    '--no-extensions',
    '--no-prompt-templates',
    '--no-themes',
    '--no-context-files',
    '--skill',
    path.join(cwd, '.agents', 'skills', 'papershelf', 'SKILL.md'),
    '--tools',
    'read,bash',
    '--thinking',
    'off',
  ];
  const model = process.env['PAPERSHELF_AGENT_EVAL_MODEL']?.trim();

  if (model !== undefined && model.length > 0) {
    args.push('--model', model);
  }

  args.push(prompt);

  return await runProcess('pi', args, {
    cwd,
    env: createPapershelfEnv(zeroEntropyBaseUrl, cwd),
    timeoutMs: Number(process.env['PAPERSHELF_AGENT_EVAL_TIMEOUT_MS'] ?? defaultPiTimeoutMs),
    signal,
  });
}

function createPapershelfEnv(zeroEntropyBaseUrl: string, cwd?: string): NodeJS.ProcessEnv {
  const localBinDir = cwd === undefined ? undefined : path.join(cwd, 'node_modules', '.bin');
  const existingPath = process.env['PATH'] ?? '';

  return {
    ...process.env,
    PATH: localBinDir === undefined ? existingPath : `${localBinDir}${path.delimiter}${existingPath}`,
    ZEROENTROPY_API_KEY: evalApiKey,
    ZEROENTROPY_BASE_URL: zeroEntropyBaseUrl,
  };
}

async function runProcess(command: string, args: readonly string[], options: ProcessOptions): Promise<ProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    };
    const abort = (): void => {
      child.kill('SIGTERM');
    };

    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

function formatProcessResult(result: ProcessResult): string {
  return [`exitCode: ${String(result.exitCode)}`, `timedOut: ${String(result.timedOut)}`, result.stdout, result.stderr]
    .filter((part) => part.length > 0)
    .join('\n');
}

function createProcessError(command: string, result: ProcessResult): Record<string, string | number | boolean | null> {
  return {
    command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stderr: result.stderr,
  };
}

function parsePiJsonEvents(stdout: string): PiJsonEvent[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return isRecord(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function collectNonJsonLines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isJsonObjectLine(line));
}

function isJsonObjectLine(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed);
  } catch {
    return false;
  }
}

function extractToolCalls(events: readonly PiJsonEvent[]): SimpleToolCallRecord[] {
  const pending = new Map<string, PendingToolCall>();
  const calls: SimpleToolCallRecord[] = [];

  for (const event of events) {
    if (event.type === 'tool_execution_start') {
      const toolCallId = readString(event['toolCallId']);
      const toolName = readString(event['toolName']);

      if (toolCallId !== undefined && toolName !== undefined) {
        pending.set(toolCallId, {
          name: toolName,
          arguments: event['args'],
        });
      }
    }

    if (event.type === 'tool_execution_end') {
      const toolCallId = readString(event['toolCallId']);
      const toolName = readString(event['toolName']);

      if (toolCallId === undefined || toolName === undefined) {
        continue;
      }

      const started = pending.get(toolCallId);
      const isError = event['isError'] === true;
      const call: SimpleToolCallRecord = {
        id: toolCallId,
        name: started?.name ?? toolName,
        arguments: started?.arguments,
      };

      if (isError) {
        call.error = event['result'];
      } else {
        call.result = event['result'];
      }

      calls.push(call);
      pending.delete(toolCallId);
    }
  }

  return calls;
}

function extractFinalAssistantText(events: readonly PiJsonEvent[]): string {
  const assistantTexts = events
    .filter((event) => event.type === 'message_end')
    .map((event) => event['message'])
    .filter(isRecord)
    .filter((message) => message['role'] === 'assistant')
    .map((message) => contentToText(message['content']))
    .filter((text) => text.trim().length > 0);

  return assistantTexts.at(-1) ?? '';
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(contentBlockToText)
      .filter((text) => text.length > 0)
      .join('');
  }

  if (content === undefined || content === null) {
    return '';
  }

  return JSON.stringify(content);
}

function contentBlockToText(block: unknown): string {
  if (typeof block === 'string') {
    return block;
  }

  if (!isRecord(block)) {
    return '';
  }

  const text = block['text'];

  return typeof text === 'string' ? text : '';
}

async function startMockZeroEntropyServer(): Promise<MockZeroEntropyServer> {
  const server = createServer((request, response) => {
    void handleMockZeroEntropyRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();

  if (!isAddressInfo(address)) {
    throw new Error('Mock ZeroEntropy server did not bind to a TCP address.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function handleMockZeroEntropyRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: 'method not allowed' });
      return;
    }

    const body = await readJsonRequest(request);

    if (request.url === '/models/embed') {
      const embedRequest = parseEmbedRequestBody(body);
      writeJson(response, 200, {
        results: embedRequest.input.map((input) => ({
          embedding: createEmbedding(input, embedRequest.dimensions),
        })),
      });
      return;
    }

    if (request.url === '/models/rerank') {
      const rerankRequest = parseRerankRequestBody(body);
      const results = rerankRequest.documents
        .map((document, index) => ({
          index,
          relevance_score: relevanceScore(rerankRequest.query, document),
        }))
        .sort((left, right) => right.relevance_score - left.relevance_score || left.index - right.index);

      writeJson(response, 200, { results });
      return;
    }

    writeJson(response, 404, { error: `unknown path: ${request.url ?? ''}` });
  } catch (error) {
    writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function readJsonRequest(request: IncomingMessage): Promise<unknown> {
  let body = '';

  for await (const chunk of request) {
    body += String(chunk);
  }

  return JSON.parse(body) as unknown;
}

function parseEmbedRequestBody(body: unknown): EmbedRequestBody {
  if (!isRecord(body) || !Array.isArray(body['input']) || !body['input'].every((value) => typeof value === 'string')) {
    throw new Error('Invalid embed request body.');
  }

  const dimensions = body['dimensions'];

  if (!Number.isInteger(dimensions) || typeof dimensions !== 'number' || dimensions <= 0) {
    throw new Error('Invalid embed dimensions.');
  }

  return {
    input: body['input'],
    dimensions,
  };
}

function parseRerankRequestBody(body: unknown): RerankRequestBody {
  if (!isRecord(body) || typeof body['query'] !== 'string') {
    throw new Error('Invalid rerank request body.');
  }

  if (!Array.isArray(body['documents']) || !body['documents'].every((value) => typeof value === 'string')) {
    throw new Error('Invalid rerank documents.');
  }

  return {
    query: body['query'],
    documents: body['documents'],
  };
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const topicKeywords = [
  ['tomato', 'seedling', 'olla', 'ollas', 'porous', 'buried jar', 'leaves dry', 'watering trips', 'moisture'],
  ['library', 'clinic', 'patients', 'large-print', 'novels', 'pharmacy'],
  ['cabbage', 'salt', 'crock', 'lactic', 'bacteria', 'sour'],
  ['school', 'diesel', 'generator', 'roof panels', 'battery', 'fuel boats'],
  ['ultrasonic', 'probe', 'featherlike hiss', 'nitrogen', 'valve stem', 'pressure test', 'leak'],
] as const;

function createEmbedding(text: string, dimensions: number): number[] {
  const scores = topicScores(text);
  const embedding: number[] = Array.from({ length: dimensions }, () => 0);

  let hasNonZeroScore = false;

  for (const [index, score] of scores.entries()) {
    if (index < dimensions) {
      embedding[index] = score;
      hasNonZeroScore ||= score !== 0;
    }
  }

  if (!hasNonZeroScore) {
    embedding[Math.min(dimensions - 1, topicKeywords.length)] = 1;
  }

  const norm = Math.hypot(...embedding);

  return norm === 0 ? embedding : embedding.map((value) => value / norm);
}

function topicScores(text: string): number[] {
  const lower = text.toLowerCase();

  return topicKeywords.map((keywords) =>
    keywords.reduce((score, keyword) => score + (lower.includes(keyword) ? 1 : 0), 0),
  );
}

function relevanceScore(query: string, document: string): number {
  const queryScores = topicScores(query);
  const documentScores = topicScores(document);
  const score = queryScores.reduce((total, queryScore, index) => total + queryScore * (documentScores[index] ?? 0), 0);

  return score === 0 ? lexicalOverlapScore(query, document) : score;
}

function lexicalOverlapScore(query: string, document: string): number {
  const queryTerms = new Set(query.toLowerCase().match(/[a-z][a-z-]+/gu) ?? []);
  const documentLower = document.toLowerCase();
  let score = 0;

  for (const term of queryTerms) {
    if (documentLower.includes(term)) {
      score += 1;
    }
  }

  return score;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAddressInfo(value: unknown): value is AddressInfo {
  return isRecord(value) && typeof value['port'] === 'number';
}
