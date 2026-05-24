import type { ChunkMetadata, SearchOutputFormat, SearchResult } from '../types.js';

export type FormatSearchResultsOptions = {
  format: SearchOutputFormat;
};

type JsonSearchResult = {
  docId: string;
  chunkIndex: number;
  text: string;
  snippet: string;
  distance: number;
  relevanceScore?: number;
  metadata?: ChunkMetadata;
};

export function formatSearchResults(results: readonly SearchResult[], options: FormatSearchResultsOptions): string {
  switch (options.format) {
    case 'json':
      return formatJsonResults(results);

    case 'text':
      return formatTextResults(results);
  }
}

function formatJsonResults(results: readonly SearchResult[]): string {
  return JSON.stringify(
    {
      results: results.map(toJsonSearchResult),
    },
    null,
    2,
  );
}

function toJsonSearchResult(result: SearchResult): JsonSearchResult {
  const jsonResult: JsonSearchResult = {
    docId: result.docId,
    chunkIndex: result.chunkIndex,
    text: result.text,
    snippet: createSnippet(result.text),
    distance: result.distance,
  };

  if (result.relevanceScore !== undefined) {
    jsonResult.relevanceScore = result.relevanceScore;
  }

  if (result.metadata !== undefined) {
    jsonResult.metadata = result.metadata;
  }

  return jsonResult;
}

function formatTextResults(results: readonly SearchResult[]): string {
  if (results.length === 0) {
    return 'No papershelf results found.';
  }

  return results.map((result, index) => formatTextResult(result, index + 1)).join('\n\n');
}

function formatTextResult(result: SearchResult, position: number): string {
  const lines = [
    `[${position}] Source: ${result.docId}`,
    `Chunk: ${result.chunkIndex}`,
    `Distance: ${formatScore(result.distance)}`,
  ];

  if (result.relevanceScore !== undefined) {
    lines.push(`Relevance score: ${formatScore(result.relevanceScore)}`);
  }

  lines.push(...formatMetadataLines(result.metadata));
  lines.push('Snippet:');
  lines.push(indent(createSnippet(result.text)));

  return lines.join('\n');
}

function formatMetadataLines(metadata: ChunkMetadata | undefined): string[] {
  if (metadata === undefined) {
    return [];
  }

  const lines: string[] = [];

  if (metadata.heading !== undefined) {
    lines.push(`Heading: ${metadata.heading}`);
  }

  if (metadata.section !== undefined) {
    lines.push(`Section: ${metadata.section}`);
  }

  if (metadata.page !== undefined) {
    lines.push(`Page: ${metadata.page}`);
  }

  const lineRange = formatLineRange(metadata);

  if (lineRange !== undefined) {
    lines.push(`Lines: ${lineRange}`);
  }

  return lines;
}

function formatLineRange(metadata: ChunkMetadata): string | undefined {
  if (metadata.startLine !== undefined && metadata.endLine !== undefined) {
    return `${metadata.startLine}-${metadata.endLine}`;
  }

  if (metadata.startLine !== undefined) {
    return `${metadata.startLine}`;
  }

  if (metadata.endLine !== undefined) {
    return `${metadata.endLine}`;
  }

  return undefined;
}

function createSnippet(text: string, maxCharacters: number = 700): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();

  if (normalized.length <= maxCharacters) {
    return normalized;
  }

  return `${normalized.slice(0, maxCharacters - 1).trimEnd()}…`;
}

function formatScore(value: number): string {
  return value.toFixed(4);
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}
