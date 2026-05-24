import type { Harness, HarnessRun, JsonValue } from 'vitest-evals/harness';

export type PapershelfEvalDocument = {
  docId: string;
  text: string;
};

export type PapershelfEvalInput = {
  name: string;
  documents: PapershelfEvalDocument[];
  query: string;
  expected: {
    topDocId?: string;
    topDocIds?: string[];
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

export const papershelfHarness: Harness<PapershelfEvalInput, PapershelfEvalOutput> = {
  name: 'papershelf-cli',
  run: async (input): Promise<HarnessRun<PapershelfEvalOutput>> => {
    throw new Error(
      `papershelfHarness is scaffold-only; implement temp-repo CLI execution before enabling eval case "${input.name}".`,
    );
  },
};
