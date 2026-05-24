import type { ChunkMetadata, SourceDocument, TextChunk } from '../types.js';

export type ChunkerOptions = {
  targetWords: number;
  overlapWords: number;
  maxCharacters: number;
};

export const textBoundaryChunkerVersion: number = 1;

export const defaultChunkerOptions: ChunkerOptions = {
  targetWords: 450,
  overlapWords: 90,
  maxCharacters: 6000,
};

type SplitPiece = {
  text: string;
  metadata: ChunkMetadata;
  separatorBefore: string;
};

type TextSegment = SplitPiece & {
  wordCount: number;
};

type ChunkDraft = {
  text: string;
  metadata: ChunkMetadata;
  wordCount: number;
};

type MarkdownHeading = {
  level: number;
  title: string;
};

export function chunkDocument(
  document: SourceDocument,
  options: ChunkerOptions = defaultChunkerOptions,
): readonly TextChunk[] {
  validateChunkerOptions(options);

  const segments = parseTextBlocks(document.text).flatMap((block) => splitPieceRecursively(block, options, 0));
  const drafts = buildChunkDrafts(segments, options);

  return drafts.map((draft, index) => {
    const text = addOverlapPrefix(drafts, draft, index, options);
    const chunk: TextChunk = {
      docId: document.docId,
      chunkIndex: index,
      text,
    };

    if (hasMetadata(draft.metadata)) {
      chunk.metadata = draft.metadata;
    }

    return chunk;
  });
}

function validateChunkerOptions(options: ChunkerOptions): void {
  if (!Number.isInteger(options.targetWords) || options.targetWords <= 0) {
    throw new Error('Chunker targetWords must be a positive integer.');
  }

  if (!Number.isInteger(options.overlapWords) || options.overlapWords < 0) {
    throw new Error('Chunker overlapWords must be a non-negative integer.');
  }

  if (!Number.isInteger(options.maxCharacters) || options.maxCharacters <= 0) {
    throw new Error('Chunker maxCharacters must be a positive integer.');
  }
}

function parseTextBlocks(text: string): readonly SplitPiece[] {
  const lines = text.split(/\r\n|\n|\r/u);
  const blocks: SplitPiece[] = [];
  const headingStack: string[] = [];
  let currentPage: number | undefined;
  let paragraphLines: string[] = [];
  let paragraphStartLine = 1;
  let inFencedBlock = false;

  const flushParagraph = (endLine: number): void => {
    if (paragraphLines.length === 0) {
      return;
    }

    const paragraphText = paragraphLines.join('\n');
    const detectedPage = detectPageNumber(paragraphLines);

    if (detectedPage !== undefined) {
      currentPage = detectedPage;
    }

    const markdownHeading = parseMarkdownHeading(paragraphText);

    if (markdownHeading !== undefined) {
      updateHeadingStack(headingStack, markdownHeading);
    }

    const metadata = createMetadata({
      heading: getCurrentHeading(headingStack),
      section: getCurrentSection(headingStack),
      page: currentPage,
      startLine: paragraphStartLine,
      endLine,
    });

    blocks.push({
      text: paragraphText,
      metadata,
      separatorBefore: blocks.length === 0 ? '' : '\n\n',
    });

    paragraphLines = [];
  };

  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineIndex + 1;

    if (line.trim().length === 0 && !inFencedBlock) {
      flushParagraph(lineNumber - 1);
      continue;
    }

    if (!inFencedBlock && parseMarkdownHeading(line) !== undefined) {
      flushParagraph(lineNumber - 1);
      paragraphStartLine = lineNumber;
      paragraphLines = [line];
      flushParagraph(lineNumber);
      continue;
    }

    if (paragraphLines.length === 0) {
      paragraphStartLine = lineNumber;
    }

    paragraphLines.push(line);

    if (isMarkdownFenceBoundary(line)) {
      inFencedBlock = !inFencedBlock;
    }
  }

  flushParagraph(lines.length);

  return blocks;
}

function splitPieceRecursively(
  piece: SplitPiece,
  options: ChunkerOptions,
  splitterIndex: number,
): readonly TextSegment[] {
  const wordCount = countWords(piece.text);

  if (wordCount === 0) {
    return [];
  }

  if (fitsInSingleSegment(piece.text, wordCount, options)) {
    return [{ ...piece, wordCount }];
  }

  const splitter = splitters[splitterIndex];

  if (splitter === undefined) {
    return [{ ...piece, wordCount }];
  }

  const childPieces = splitter(piece, options);
  const firstChild = childPieces[0];

  if (childPieces.length <= 1 && firstChild?.text === piece.text) {
    return splitPieceRecursively(piece, options, splitterIndex + 1);
  }

  return childPieces.flatMap((childPiece) => splitPieceRecursively(childPiece, options, splitterIndex + 1));
}

const splitters: readonly [
  (piece: SplitPiece, options: ChunkerOptions) => readonly SplitPiece[],
  (piece: SplitPiece, options: ChunkerOptions) => readonly SplitPiece[],
  (piece: SplitPiece, options: ChunkerOptions) => readonly SplitPiece[],
  (piece: SplitPiece, options: ChunkerOptions) => readonly SplitPiece[],
] = [splitByLines, splitBySentences, splitByClauses, splitByWords];

function splitByLines(piece: SplitPiece): readonly SplitPiece[] {
  if (!piece.text.includes('\n')) {
    return [piece];
  }

  const startLine = piece.metadata.startLine;

  if (startLine === undefined) {
    return [piece];
  }

  const pieces: SplitPiece[] = [];

  for (const [lineOffset, line] of piece.text.split('\n').entries()) {
    if (line.trim().length === 0) {
      continue;
    }

    const lineNumber = startLine + lineOffset;

    pieces.push({
      text: line,
      metadata: withLineRange(piece.metadata, lineNumber, lineNumber),
      separatorBefore: pieces.length === 0 ? piece.separatorBefore : '\n',
    });
  }

  return pieces.length === 0 ? [piece] : pieces;
}

function splitBySentences(piece: SplitPiece): readonly SplitPiece[] {
  const sentenceMatches = piece.text.match(/[^.!?]+[.!?]+(?:["')\]}]+)?|[^.!?]+$/gu);

  if (sentenceMatches === null || sentenceMatches.length <= 1) {
    return [piece];
  }

  return createSequentialPieces(piece, sentenceMatches, ' ');
}

function splitByClauses(piece: SplitPiece): readonly SplitPiece[] {
  const parts: string[] = [];
  let startIndex = 0;

  for (let characterIndex = 0; characterIndex < piece.text.length; characterIndex += 1) {
    const character = piece.text[characterIndex];

    if (character === undefined || !isClauseDelimiter(character)) {
      continue;
    }

    parts.push(piece.text.slice(startIndex, characterIndex + character.length));
    startIndex = characterIndex + character.length;
  }

  parts.push(piece.text.slice(startIndex));

  if (parts.length <= 1) {
    return [piece];
  }

  return createSequentialPieces(piece, parts, ' ');
}

function splitByWords(piece: SplitPiece, options: ChunkerOptions): readonly SplitPiece[] {
  const words = piece.text.match(/\S+/gu);

  if (words === null || words.length <= 1) {
    return [piece];
  }

  const groups: string[] = [];
  let currentWords: string[] = [];

  for (const word of words) {
    if (currentWords.length === 0) {
      currentWords.push(word);
      continue;
    }

    const candidateWords = [...currentWords, word];
    const candidateText = candidateWords.join(' ');

    if (candidateWords.length > options.targetWords || candidateText.length > options.maxCharacters) {
      groups.push(currentWords.join(' '));
      currentWords = [word];
      continue;
    }

    currentWords = candidateWords;
  }

  if (currentWords.length > 0) {
    groups.push(currentWords.join(' '));
  }

  return groups.length <= 1 ? [piece] : createSequentialPieces(piece, groups, ' ');
}

function buildChunkDrafts(segments: readonly TextSegment[], options: ChunkerOptions): readonly ChunkDraft[] {
  const chunks: ChunkDraft[] = [];
  let currentSegments: TextSegment[] = [];

  for (const segment of segments) {
    if (currentSegments.length > 0 && wouldExceedChunkLimits(currentSegments, segment, options)) {
      chunks.push(createChunkDraft(currentSegments));
      currentSegments = [];
    }

    currentSegments.push(segment);
  }

  if (currentSegments.length > 0) {
    chunks.push(createChunkDraft(currentSegments));
  }

  return chunks;
}

function wouldExceedChunkLimits(
  currentSegments: readonly TextSegment[],
  nextSegment: TextSegment,
  options: ChunkerOptions,
): boolean {
  const candidateSegments = [...currentSegments, nextSegment];
  const candidateWords = candidateSegments.reduce((total, segment) => total + segment.wordCount, 0);

  return candidateWords > options.targetWords || joinSegments(candidateSegments).length > options.maxCharacters;
}

function createChunkDraft(segments: readonly TextSegment[]): ChunkDraft {
  return {
    text: joinSegments(segments),
    metadata: mergeMetadata(segments),
    wordCount: segments.reduce((total, segment) => total + segment.wordCount, 0),
  };
}

function joinSegments(segments: readonly TextSegment[]): string {
  let text = '';

  for (const [index, segment] of segments.entries()) {
    text += `${index === 0 ? '' : segment.separatorBefore}${segment.text}`;
  }

  return text;
}

function addOverlapPrefix(
  drafts: readonly ChunkDraft[],
  draft: ChunkDraft,
  index: number,
  options: ChunkerOptions,
): string {
  if (index === 0 || options.overlapWords === 0) {
    return draft.text;
  }

  const previousDraft = drafts[index - 1];

  if (previousDraft === undefined) {
    return draft.text;
  }

  const separator = '\n\n';
  const characterBudget = options.maxCharacters - draft.text.length - separator.length;
  const prefix = getTailWordsWithinBudget(previousDraft.text, options.overlapWords, characterBudget);

  return prefix === undefined ? draft.text : `${prefix}${separator}${draft.text}`;
}

function getTailWordsWithinBudget(text: string, wordLimit: number, maxCharacters: number): string | undefined {
  if (wordLimit <= 0 || maxCharacters <= 0) {
    return undefined;
  }

  const words = text.match(/\S+/gu);

  if (words === null || words.length === 0) {
    return undefined;
  }

  let selectedWordCount = Math.min(wordLimit, words.length);

  while (selectedWordCount > 0) {
    const candidate = words.slice(words.length - selectedWordCount).join(' ');

    if (candidate.length <= maxCharacters) {
      return candidate;
    }

    selectedWordCount -= 1;
  }

  return undefined;
}

function fitsInSingleSegment(text: string, wordCount: number, options: ChunkerOptions): boolean {
  return wordCount <= options.targetWords && (text.length <= options.maxCharacters || wordCount === 1);
}

function countWords(text: string): number {
  return text.match(/\S+/gu)?.length ?? 0;
}

function createSequentialPieces(
  piece: SplitPiece,
  rawParts: readonly string[],
  separator: string,
): readonly SplitPiece[] {
  const parts = rawParts.map((part) => part.trim()).filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return [piece];
  }

  return parts.map((part, index) => ({
    text: part,
    metadata: piece.metadata,
    separatorBefore: index === 0 ? piece.separatorBefore : separator,
  }));
}

function parseMarkdownHeading(text: string): MarkdownHeading | undefined {
  if (text.includes('\n')) {
    return undefined;
  }

  const match = /^(?: {0,3})(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(text.trimEnd());
  const marker = match?.[1];
  const rawTitle = match?.[2];

  if (marker === undefined || rawTitle === undefined) {
    return undefined;
  }

  const title = rawTitle.replace(/\s+#+\s*$/u, '').trim();

  if (title.length === 0) {
    return undefined;
  }

  return {
    level: marker.length,
    title,
  };
}

function updateHeadingStack(headingStack: string[], heading: MarkdownHeading): void {
  headingStack.length = Math.max(0, heading.level - 1);
  headingStack[heading.level - 1] = heading.title;
  headingStack.length = heading.level;
}

function getCurrentHeading(headingStack: readonly string[]): string | undefined {
  for (let index = headingStack.length - 1; index >= 0; index -= 1) {
    const heading = headingStack[index];

    if (heading !== undefined && heading.length > 0) {
      return heading;
    }
  }

  return undefined;
}

function getCurrentSection(headingStack: readonly string[]): string | undefined {
  const section = headingStack.filter((heading) => heading !== undefined && heading.length > 0).join(' > ');
  return section.length === 0 ? undefined : section;
}

function detectPageNumber(lines: readonly string[]): number | undefined {
  for (const line of lines) {
    const trimmedLine = line.trim();
    const pageMatch =
      /^\[?\s*(?:page|p\.)\s*(?:#|:|-)?\s*(\d{1,6})\s*\]?$/iu.exec(trimmedLine) ??
      /^-+\s*(?:page|p\.)\s*(?:#|:|-)?\s*(\d{1,6})\s*-+$/iu.exec(trimmedLine);
    const rawPage = pageMatch?.[1];

    if (rawPage === undefined) {
      continue;
    }

    const page = Number.parseInt(rawPage, 10);

    if (Number.isSafeInteger(page)) {
      return page;
    }
  }

  return undefined;
}

function isClauseDelimiter(character: string): boolean {
  return character === ',' || character === ';' || character === ':' || character === '—' || character === '–';
}

function isMarkdownFenceBoundary(line: string): boolean {
  return /^(?: {0,3})(?:```|~~~)/u.test(line);
}

function mergeMetadata(segments: readonly TextSegment[]): ChunkMetadata {
  const metadata = createMetadata({
    heading: firstDefined(segments.map((segment) => segment.metadata.heading)),
    section: firstDefined(segments.map((segment) => segment.metadata.section)),
    page: firstDefined(segments.map((segment) => segment.metadata.page)),
    startLine: minDefined(segments.map((segment) => segment.metadata.startLine)),
    endLine: maxDefined(segments.map((segment) => segment.metadata.endLine)),
  });

  return metadata;
}

function createMetadata(input: {
  heading: string | undefined;
  section: string | undefined;
  page: number | undefined;
  startLine: number | undefined;
  endLine: number | undefined;
}): ChunkMetadata {
  const metadata: ChunkMetadata = {};

  if (input.heading !== undefined) {
    metadata.heading = input.heading;
  }

  if (input.section !== undefined) {
    metadata.section = input.section;
  }

  if (input.page !== undefined) {
    metadata.page = input.page;
  }

  if (input.startLine !== undefined) {
    metadata.startLine = input.startLine;
  }

  if (input.endLine !== undefined) {
    metadata.endLine = input.endLine;
  }

  return metadata;
}

function withLineRange(metadata: ChunkMetadata, startLine: number, endLine: number): ChunkMetadata {
  return createMetadata({
    heading: metadata.heading,
    section: metadata.section,
    page: metadata.page,
    startLine,
    endLine,
  });
}

function firstDefined<Value>(values: readonly (Value | undefined)[]): Value | undefined {
  return values.find((value) => value !== undefined);
}

function minDefined(values: readonly (number | undefined)[]): number | undefined {
  const numbers = values.filter((value) => value !== undefined);
  return numbers.length === 0 ? undefined : Math.min(...numbers);
}

function maxDefined(values: readonly (number | undefined)[]): number | undefined {
  const numbers = values.filter((value) => value !== undefined);
  return numbers.length === 0 ? undefined : Math.max(...numbers);
}

function hasMetadata(metadata: ChunkMetadata): boolean {
  return (
    metadata.heading !== undefined ||
    metadata.section !== undefined ||
    metadata.page !== undefined ||
    metadata.startLine !== undefined ||
    metadata.endLine !== undefined
  );
}
