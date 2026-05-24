import type { DescribeEvalOptions } from 'vitest-evals';
import { papershelfHarness, type PapershelfEvalInput, type PapershelfEvalOutput } from './harness.js';

export const papershelfEvals: DescribeEvalOptions<PapershelfEvalInput, PapershelfEvalOutput> = {
  harness: papershelfHarness,
};
