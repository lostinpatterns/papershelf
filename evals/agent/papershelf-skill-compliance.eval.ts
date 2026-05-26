import { expect } from 'vitest';
import { describeEval, toolCalls, type ToolCallRecord } from 'vitest-evals';
import { papershelfAgentHarness, type PapershelfAgentEvalInput } from './papershelf-agent-harness.js';

type EvidenceUsed = {
  query: string;
  sourcePath: string;
  quote: string;
};

type SearchJsonMetadata = {
  heading?: string;
  section?: string;
  page?: number;
  startLine?: number;
  endLine?: number;
};

type SearchJsonResult = {
  docId: string;
  chunkIndex: number;
  text: string;
  snippet: string;
  metadata?: SearchJsonMetadata;
};

type SearchJsonOutput = {
  results: SearchJsonResult[];
};

type SearchInvocation = {
  callIndex: number;
  command: string;
  query: string;
  json: SearchJsonOutput;
};

type ReadInvocation = {
  callIndex: number;
  path: string;
  offset: number | undefined;
  limit: number | undefined;
};

type LineRange = {
  startLine: number;
  endLine: number;
};

const expectedRelevantDocId = '.papershelf/docs/garden/slow-irrigation.md';
const expectedTechniquePattern =
  /\b(?:clay\s+ollas?|buried\s+jars?|slow(?:ly)?\s+release[s]?\s+water\s+near\s+roots)\b/iu;
const expectedLongDocId = '.papershelf/docs/manuals/greenhouse-pump.md';
const expectedLongDocQuote =
  'When the nitrogen valve seat leaks, an ultrasonic probe hears a featherlike hiss beside the brass valve stem.';
const expectedLongDocAnswerPattern = /\b(?:ultrasonic\s+probe|featherlike\s+hiss|nitrogen\s+valve)\b/iu;
const longDocumentText = createLongValveDiagnosticsDocument();
const expectedLongDocQuoteLine = lineNumberContaining(longDocumentText, expectedLongDocQuote);
const longDocumentLineCount = countLines(longDocumentText);

const documents = [
  {
    path: 'garden/slow-irrigation.md',
    text:
      'Tomato seedlings thrived after the grower switched to clay ollas that release water slowly near roots. ' +
      'The buried jars kept leaves dry and cut watering trips during the heat wave.',
  },
  {
    path: 'community/library-van.md',
    text: 'The library van now parks outside the clinic every Tuesday. Patients can borrow large-print novels and return them at the pharmacy counter.',
  },
  {
    path: 'food/cabbage-crock.md',
    text: 'Cabbage packed with salt began bubbling by the third day. The crock smelled pleasantly sour once lactic bacteria took hold.',
  },
  {
    path: 'energy/island-school-power.md',
    text: 'The island school replaced its diesel generator with roof panels and a battery shed. Evening classes continued even when fuel boats were delayed.',
  },
] satisfies PapershelfAgentEvalInput['documents'];

const longChunkDocuments = [
  {
    path: 'manuals/greenhouse-pump.md',
    text: longDocumentText,
  },
  {
    path: 'garden/slow-irrigation.md',
    text:
      'Tomato seedlings thrived after the grower switched to clay ollas that release water slowly near roots. ' +
      'The buried jars kept leaves dry and cut watering trips during the heat wave.',
  },
  {
    path: 'community/library-van.md',
    text: 'The library van now parks outside the clinic every Tuesday. Patients can borrow large-print novels and return them at the pharmacy counter.',
  },
  {
    path: 'food/cabbage-crock.md',
    text: 'Cabbage packed with salt began bubbling by the third day. The crock smelled pleasantly sour once lactic bacteria took hold.',
  },
  {
    path: 'energy/island-school-power.md',
    text: 'The island school replaced its diesel generator with roof panels and a battery shed. Evening classes continued even when fuel boats were delayed.',
  },
] satisfies PapershelfAgentEvalInput['documents'];

describeEval(
  'papershelf skill agent compliance',
  {
    harness: papershelfAgentHarness,
    skipIf: () => process.env['PAPERSHELF_RUN_AGENT_EVALS'] !== '1',
  },
  (it) => {
    it('uses repo-local JSON search and cites exact retrieved provenance', async ({ run }) => {
      const result = await run(createInput());

      expect(result.errors, 'agent run errors').toEqual([]);

      const calls = toolCalls(result.session);
      const searchInvocations = extractSearchInvocations(calls);
      const evidence = parseEvidenceUsed(result.output);
      const answer = answerBeforeEvidence(result.output);
      const citedSearch = searchInvocations.find((invocation) => invocation.query === evidence.query);
      const citedResult = citedSearch?.json.results.find((searchResult) => searchResult.docId === evidence.sourcePath);

      expect(searchInvocations.length, 'pnpm papershelf search ... --json calls').toBeGreaterThan(0);
      expect(citedSearch, 'Evidence used query matches an actual pnpm papershelf search ... --json call').toBeDefined();
      expect(citedResult, 'Evidence used source path matches a returned JSON result docId').toBeDefined();
      expect(
        citedResult !== undefined &&
          (citedResult.text.includes(evidence.quote) || citedResult.snippet.includes(evidence.quote)),
        'Evidence used quote is copied exactly from returned JSON text or snippet',
      ).toBe(true);
      expect(evidence.sourcePath, 'Evidence used cites the relevant fixture document').toBe(expectedRelevantDocId);
      expect(answer, 'answer names the retrieved technique, not just a valid citation').toMatch(
        expectedTechniquePattern,
      );
    });

    it('identifies a line-scoped chunk in a long document so the agent can read only that section', async ({ run }) => {
      const result = await run(createLongChunkInput());

      expect(result.errors, 'agent run errors').toEqual([]);

      const calls = toolCalls(result.session);
      const searchInvocations = extractSearchInvocations(calls);
      const evidence = parseEvidenceUsed(result.output);
      const answer = answerBeforeEvidence(result.output);
      const citedSearch = searchInvocations.find((invocation) => invocation.query === evidence.query);
      const citedResult = citedSearch?.json.results.find((searchResult) => searchResult.docId === evidence.sourcePath);

      expect(searchInvocations.length, 'pnpm papershelf search ... --json calls').toBeGreaterThan(0);
      expect(citedSearch, 'Evidence used query matches an actual pnpm papershelf search ... --json call').toBeDefined();
      expect(citedResult, 'Evidence used source path matches a returned JSON result docId').toBeDefined();

      if (citedResult === undefined || citedSearch === undefined) {
        return;
      }

      const citedLineRange = readSearchResultLineRange(citedResult);

      expect(citedResult.docId, 'Evidence used cites the long fixture document').toBe(expectedLongDocId);
      expect(citedResult.chunkIndex, 'search result is not the first chunk of the long document').toBeGreaterThan(0);
      expect(citedResult.text, 'retrieved chunk contains the target diagnostic passage').toContain(
        expectedLongDocQuote,
      );
      expect(
        citedResult.text.includes(evidence.quote) || citedResult.snippet.includes(evidence.quote),
        'Evidence used quote is copied exactly from returned JSON text or snippet',
      ).toBe(true);
      expect(citedLineRange, 'retrieved chunk exposes start/end line metadata for offset reads').toBeDefined();

      if (citedLineRange === undefined) {
        return;
      }

      const targetRead = extractReadInvocations(calls).find(
        (readInvocation) =>
          readInvocationMatchesDoc(readInvocation, expectedLongDocId) &&
          readInvocationCoversLineRange(readInvocation, citedLineRange),
      );

      expect(citedLineRange.startLine, 'line metadata starts before the target quote').toBeLessThanOrEqual(
        expectedLongDocQuoteLine,
      );
      expect(citedLineRange.endLine, 'line metadata ends after the target quote').toBeGreaterThanOrEqual(
        expectedLongDocQuoteLine,
      );
      expect(
        citedLineRange.endLine - citedLineRange.startLine + 1,
        'returned line range is much smaller than the full document',
      ).toBeLessThan(longDocumentLineCount / 2);
      expect(
        targetRead,
        'agent reads the cited source path with offset/limit covering the returned line range',
      ).toBeDefined();

      if (targetRead === undefined) {
        return;
      }

      expect(targetRead.callIndex, 'agent reads the file after semantic search identifies the chunk').toBeGreaterThan(
        citedSearch.callIndex,
      );
      expect(targetRead.limit, 'read uses a limit smaller than the whole long document').toBeLessThan(
        longDocumentLineCount / 2,
      );
      expect(answer, 'answer names the diagnostic method from the retrieved chunk').toMatch(
        expectedLongDocAnswerPattern,
      );
    });
  },
);

function createInput(): PapershelfAgentEvalInput {
  return {
    name: 'tomato ollas provenance',
    documents,
    prompt:
      '/skill:papershelf\n\n' +
      'Use the local Papershelf corpus to answer this question: ' +
      'What technique kept tomato leaves dry and reduced watering trips during hot weather?\n\n' +
      'Answer in one sentence, then include an "Evidence used" section with exactly these fields:\n' +
      '- query: <the exact search query you ran>\n' +
      '- source path: <the source path from the JSON result>\n' +
      '- quote: <a short exact quote copied from the JSON result text or snippet>',
  };
}

function createLongChunkInput(): PapershelfAgentEvalInput {
  return {
    name: 'long document chunk locality',
    documents: longChunkDocuments,
    prompt:
      '/skill:papershelf\n\n' +
      'Use the local Papershelf corpus to answer this question: ' +
      'Which diagnostic method reveals the hidden nitrogen valve leak in the greenhouse pump manual?\n\n' +
      'Run a focused `pnpm papershelf search ... --json` semantic search first. ' +
      'Use the returned JSON metadata to identify the relevant chunk line range, then call the read tool on the source path with offset and limit covering only that returned line range rather than the whole file.\n\n' +
      'Answer in one sentence, then include an "Evidence used" section with exactly these fields:\n' +
      '- query: <the exact search query you ran>\n' +
      '- source path: <the source path from the JSON result>\n' +
      '- chunk index: <the chunkIndex from the JSON result>\n' +
      '- line range: <startLine-endLine from the JSON result metadata>\n' +
      '- read offset: <the offset used in the read tool call>\n' +
      '- read limit: <the limit used in the read tool call>\n' +
      '- quote: <a short exact quote copied from the JSON result text or snippet>',
  };
}

function answerBeforeEvidence(output: string): string {
  const sectionStart = output.search(/(?:^|\n)\s*(?:#+\s*)?Evidence used\s*:?/iu);

  return sectionStart === -1 ? output.trim() : output.slice(0, sectionStart).trim();
}

function parseEvidenceUsed(output: string): EvidenceUsed {
  const sectionMatch = /(?:^|\n)#+\s*Evidence used\s*\n(?<body>[\s\S]*)/iu.exec(output);
  const body = sectionMatch?.groups?.['body'] ?? output.slice(output.toLowerCase().indexOf('evidence used'));

  return {
    query: stripMarkdownQuote(requiredField(body, 'query')),
    sourcePath: stripMarkdownQuote(requiredField(body, 'source path')),
    quote: stripMarkdownQuote(requiredField(body, 'quote')),
  };
}

function requiredField(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${escaped}\\s*:\\s*(?<value>.+)`, 'iu').exec(text);
  const value = match?.groups?.['value']?.trim();

  if (value === undefined || value.length === 0) {
    throw new Error(`Missing Evidence used field: ${label}`);
  }

  return value;
}

function stripMarkdownQuote(value: string): string {
  let stripped = value.trim();

  if ((stripped.startsWith('"') && stripped.endsWith('"')) || (stripped.startsWith('“') && stripped.endsWith('”'))) {
    stripped = stripped.slice(1, -1);
  }

  if (stripped.startsWith('`') && stripped.endsWith('`')) {
    stripped = stripped.slice(1, -1);
  }

  return stripped.trim();
}

function extractSearchInvocations(calls: readonly ToolCallRecord[]): SearchInvocation[] {
  return calls.flatMap((call, callIndex) => {
    if (call.name !== 'bash') {
      return [];
    }

    const command = readCommandArgument(call);
    const parsedCommand = parsePnpmPapershelfSearchCommand(command);

    if (parsedCommand === undefined || !parsedCommand.usesJson) {
      return [];
    }

    const json = parseSearchJsonFromToolResult(call.result);

    return json === undefined
      ? []
      : [
          {
            callIndex,
            command,
            query: parsedCommand.query,
            json,
          },
        ];
  });
}

function readCommandArgument(call: ToolCallRecord): string {
  const command = call.arguments?.['command'];

  return typeof command === 'string' ? command : '';
}

function extractReadInvocations(calls: readonly ToolCallRecord[]): ReadInvocation[] {
  return calls.flatMap((call, callIndex) => {
    if (call.name !== 'read') {
      return [];
    }

    const readPath = call.arguments?.['path'];

    if (typeof readPath !== 'string') {
      return [];
    }

    return [
      {
        callIndex,
        path: readPath,
        offset: readIntegerArgument(call, 'offset'),
        limit: readIntegerArgument(call, 'limit'),
      },
    ];
  });
}

function readIntegerArgument(call: ToolCallRecord, name: string): number | undefined {
  const value = call.arguments?.[name];

  return Number.isInteger(value) && typeof value === 'number' ? value : undefined;
}

function parsePnpmPapershelfSearchCommand(command: string): { query: string; usesJson: boolean } | undefined {
  const words = splitShellWords(command);
  const searchStart = findSubsequence(words, ['pnpm', 'papershelf', 'search']);

  if (searchStart === -1) {
    return undefined;
  }

  const searchArgs = words.slice(searchStart + 3, firstShellOperatorIndex(words, searchStart + 3));
  const usesJson = searchArgs.includes('--json');
  const query = searchArgs
    .filter((word) => word !== '--json' && !word.startsWith('-'))
    .join(' ')
    .trim();

  return query.length === 0 ? undefined : { query, usesJson };
}

function splitShellWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: 'single' | 'double' | undefined;
  let escaped = false;

  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === '\\') {
      escaped = true;
      continue;
    }

    if (quote === 'single') {
      if (character === "'") {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (quote === 'double') {
      if (character === '"') {
        quote = undefined;
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'") {
      quote = 'single';
      continue;
    }

    if (character === '"') {
      quote = 'double';
      continue;
    }

    if (/\s/u.test(character)) {
      if (current.length > 0) {
        words.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    words.push(current);
  }

  return words;
}

function findSubsequence(words: readonly string[], subsequence: readonly string[]): number {
  for (let index = 0; index <= words.length - subsequence.length; index += 1) {
    if (subsequence.every((word, offset) => words[index + offset] === word)) {
      return index;
    }
  }

  return -1;
}

function firstShellOperatorIndex(words: readonly string[], startIndex: number): number {
  const operatorIndex = words.findIndex((word, index) => index >= startIndex && isShellOperator(word));

  return operatorIndex === -1 ? words.length : operatorIndex;
}

function isShellOperator(word: string): boolean {
  return word === '&&' || word === '||' || word === ';' || word === '|';
}

function readSearchResultLineRange(result: SearchJsonResult): LineRange | undefined {
  const startLine = result.metadata?.startLine;
  const endLine = result.metadata?.endLine;

  return startLine === undefined || endLine === undefined ? undefined : { startLine, endLine };
}

function readInvocationMatchesDoc(invocation: ReadInvocation, docId: string): boolean {
  const normalizedPath = invocation.path.replace(/\\/gu, '/').replace(/^\.\//u, '');

  return normalizedPath === docId || normalizedPath.endsWith(`/${docId}`);
}

function readInvocationCoversLineRange(invocation: ReadInvocation, lineRange: LineRange): boolean {
  if (invocation.offset === undefined || invocation.limit === undefined || invocation.limit <= 0) {
    return false;
  }

  const readEndLine = invocation.offset + invocation.limit - 1;

  return invocation.offset <= lineRange.startLine && readEndLine >= lineRange.endLine;
}

function lineNumberContaining(text: string, needle: string): number {
  const lineIndex = text.split(/\r\n|\n|\r/u).findIndex((line) => line.includes(needle));

  if (lineIndex === -1) {
    throw new Error(`Long document fixture does not contain expected text: ${needle}`);
  }

  return lineIndex + 1;
}

function countLines(text: string): number {
  return text.split(/\r\n|\n|\r/u).length;
}

function createLongValveDiagnosticsDocument(): string {
  return [
    '# Greenhouse Pump Service Manual',
    '## Routine Intake Ledger',
    ...createNumberedParagraphs(
      'Routine intake entry',
      'logged gasket color, bracket torque, dust level, hose slack, panel temperature, and filter tag.',
      49,
    ),
    '## Pressure Test Signatures',
    expectedLongDocQuote,
    'The technician records the tone in the fault log, tags the coupling with blue tape, and schedules a bench repair before the evening irrigation cycle.',
    'Only this diagnostic entry mentions the acoustic signature; neighboring sections discuss ordinary cleaning, shelf inventory, and seasonal storage tasks.',
    '## Parts Shelf Inventory',
    ...createNumberedParagraphs(
      'Inventory shelf entry',
      'counted spare washers, clamp labels, brush handles, carton codes, seal packets, and receipt folders.',
      44,
    ),
    '## Winter Storage Appendix',
    ...createNumberedParagraphs(
      'Storage appendix entry',
      'listed crate spacing, blanket folds, battery dates, wheel chocks, cover ties, and room humidity.',
      30,
    ),
  ].join('\n\n');
}

function createNumberedParagraphs(prefix: string, sentence: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${String(index + 1).padStart(2, '0')} ${sentence}`);
}

function parseSearchJsonFromToolResult(result: unknown): SearchJsonOutput | undefined {
  const text = toolResultText(result);
  const jsonText = extractJsonObject(text);

  if (jsonText === undefined) {
    return undefined;
  }

  const parsed = JSON.parse(jsonText) as unknown;

  if (!isSearchJsonOutput(parsed)) {
    return undefined;
  }

  return parsed;
}

function toolResultText(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }

  if (!isRecord(result)) {
    return '';
  }

  const content = result['content'];

  if (!Array.isArray(content)) {
    return '';
  }

  return content.map(contentBlockText).join('');
}

function contentBlockText(block: unknown): string {
  if (typeof block === 'string') {
    return block;
  }

  if (!isRecord(block)) {
    return '';
  }

  const text = block['text'];

  return typeof text === 'string' ? text : '';
}

function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  return start === -1 || end === -1 || end < start ? undefined : text.slice(start, end + 1);
}

function isSearchJsonOutput(value: unknown): value is SearchJsonOutput {
  return isRecord(value) && Array.isArray(value['results']) && value['results'].every(isSearchJsonResult);
}

function isSearchJsonResult(value: unknown): value is SearchJsonResult {
  return (
    isRecord(value) &&
    typeof value['docId'] === 'string' &&
    typeof value['chunkIndex'] === 'number' &&
    Number.isInteger(value['chunkIndex']) &&
    typeof value['text'] === 'string' &&
    typeof value['snippet'] === 'string' &&
    (value['metadata'] === undefined || isSearchJsonMetadata(value['metadata']))
  );
}

function isSearchJsonMetadata(value: unknown): value is SearchJsonMetadata {
  return (
    isRecord(value) &&
    isOptionalString(value['heading']) &&
    isOptionalString(value['section']) &&
    isOptionalNumber(value['page']) &&
    isOptionalNumber(value['startLine']) &&
    isOptionalNumber(value['endLine'])
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
