import { describe, expect, it } from 'vitest';
import type { SourceDocument } from '../types.js';
import { chunkDocument, defaultChunkerOptions } from './text-boundaries.js';

describe('text-boundary chunker', () => {
  it('uses the MVP default chunking options', () => {
    expect(defaultChunkerOptions).toEqual({
      targetWords: 450,
      overlapWords: 90,
      maxCharacters: 6000,
    });
  });

  it('keeps a short document in one citeable chunk with line metadata', () => {
    const chunks = chunkDocument(createDocument('First paragraph stays intact.\n\nSecond paragraph stays too.'));

    expect(chunks).toEqual([
      {
        docId: '.papershelf/docs/test.md',
        chunkIndex: 0,
        text: 'First paragraph stays intact.\n\nSecond paragraph stays too.',
        metadata: {
          startLine: 1,
          endLine: 3,
        },
      },
    ]);
  });

  it('splits long text on sentence boundaries before falling back to words', () => {
    const chunks = chunkDocument(createDocument('Alpha one two. Beta three four. Gamma five six. Delta seven eight.'), {
      targetWords: 4,
      overlapWords: 0,
      maxCharacters: 200,
    });

    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2, 3]);
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'Alpha one two.',
      'Beta three four.',
      'Gamma five six.',
      'Delta seven eight.',
    ]);
  });

  it('adds stable word overlap between adjacent chunks', () => {
    const chunks = chunkDocument(createDocument(createWords(12)), {
      targetWords: 5,
      overlapWords: 2,
      maxCharacters: 200,
    });

    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(firstWords(chunks[1]?.text ?? '', 2)).toEqual(lastWords(chunks[0]?.text ?? '', 2));
    expect(firstWords(chunks[2]?.text ?? '', 2)).toEqual(lastWords(chunks[1]?.text ?? '', 2));
  });

  it('carries Markdown heading and section metadata onto chunks', () => {
    const text = `# Introduction\n${createWords(8, 'intro')}\n\n## Method\n${createWords(8, 'method')}`;
    const chunks = chunkDocument(createDocument(text), {
      targetWords: 6,
      overlapWords: 0,
      maxCharacters: 200,
    });

    const methodChunk = chunks.find((chunk) => chunk.text.includes('method01'));

    expect(methodChunk?.metadata).toMatchObject({
      heading: 'Method',
      section: 'Introduction > Method',
    });
  });

  it('carries page metadata when a page marker is detectable in text', () => {
    const chunks = chunkDocument(createDocument('[Page 12]\n\nThis passage is on the detected page.'), {
      targetWords: 100,
      overlapWords: 0,
      maxCharacters: 1000,
    });

    expect(chunks[0]?.metadata).toMatchObject({ page: 12 });
  });

  it('keeps chunks under the max character cap when word boundaries make that possible', () => {
    const chunks = chunkDocument(createDocument('aaaa bbbb cccc dddd eeee ffff'), {
      targetWords: 100,
      overlapWords: 0,
      maxCharacters: 14,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.text.length <= 14)).toBe(true);
    expect(chunks.map((chunk) => chunk.text)).toEqual(['aaaa bbbb cccc', 'dddd eeee ffff']);
  });

  it('allows a single oversized token when no word boundary can satisfy the max character cap', () => {
    const longToken = 'x'.repeat(25);
    const chunks = chunkDocument(createDocument(longToken), {
      targetWords: 10,
      overlapWords: 0,
      maxCharacters: 10,
    });

    expect(chunks).toEqual([
      {
        docId: '.papershelf/docs/test.md',
        chunkIndex: 0,
        text: longToken,
        metadata: {
          startLine: 1,
          endLine: 1,
        },
      },
    ]);
  });

  it('does not strip fenced blocks or privacy-looking text', () => {
    const chunks = chunkDocument(createDocument('Before\n\n```secret\n# Not a heading\nPRIVATE DATA\n```\n\nAfter'), {
      targetWords: 100,
      overlapWords: 0,
      maxCharacters: 1000,
    });

    expect(chunks[0]?.text).toContain('```secret');
    expect(chunks[0]?.text).toContain('# Not a heading');
    expect(chunks[0]?.text).toContain('PRIVATE DATA');
    expect(chunks[0]?.metadata?.heading).toBeUndefined();
  });
});

function createDocument(text: string): SourceDocument {
  return {
    docId: '.papershelf/docs/test.md',
    absolutePath: '/tmp/test.md',
    contentHash: 'hash',
    text,
  };
}

function createWords(count: number, prefix = 'word'): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`).join(' ');
}

function firstWords(text: string, count: number): readonly string[] {
  return words(text).slice(0, count);
}

function lastWords(text: string, count: number): readonly string[] {
  return words(text).slice(-count);
}

function words(text: string): readonly string[] {
  return text.match(/\S+/gu) ?? [];
}
