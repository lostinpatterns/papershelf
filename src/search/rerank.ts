import type { RerankModel, RerankResult, SearchCandidate, SearchResult } from '../types.js';
import type { RerankRequest, RerankResponse } from '../providers/zeroentropy.js';

export type Reranker = {
  rerank(request: RerankRequest): Promise<RerankResponse>;
};

export type ApplyRerankerOptions = {
  client: Reranker;
  rerankModel: RerankModel;
  query: string;
  candidates: readonly SearchCandidate[];
  candidateLimit: number;
  resultLimit: number;
};

export type RerankerOrdering = {
  results: readonly RerankResult[];
  failedOpen: boolean;
};

export async function applyReranker(options: ApplyRerankerOptions): Promise<readonly SearchResult[]> {
  validateNonNegativeInteger(options.candidateLimit, 'Candidate limit');
  validateNonNegativeInteger(options.resultLimit, 'Result limit');

  const candidates = options.candidates.slice(0, options.candidateLimit);

  if (candidates.length === 0 || options.resultLimit === 0) {
    return [];
  }

  try {
    const response = await options.client.rerank({
      model: options.rerankModel,
      query: options.query,
      documents: candidates.map((candidate) => candidate.text),
    });

    return applyRerankResults(candidates, response.results, options.resultLimit);
  } catch {
    return candidates.slice(0, options.resultLimit);
  }
}

function applyRerankResults(
  candidates: readonly SearchCandidate[],
  rerankResults: readonly RerankResult[],
  resultLimit: number,
): readonly SearchResult[] {
  const orderedResults: SearchResult[] = [];
  const seenCandidateIndexes = new Set<number>();
  const rankedResults = [...rerankResults].sort(compareRerankResults);

  for (const result of rankedResults) {
    const candidate = candidates[result.index];

    if (candidate === undefined || seenCandidateIndexes.has(result.index)) {
      continue;
    }

    orderedResults.push({
      ...candidate,
      relevanceScore: result.relevanceScore,
    });
    seenCandidateIndexes.add(result.index);

    if (orderedResults.length >= resultLimit) {
      return orderedResults;
    }
  }

  for (const [index, candidate] of candidates.entries()) {
    if (seenCandidateIndexes.has(index)) {
      continue;
    }

    orderedResults.push(candidate);

    if (orderedResults.length >= resultLimit) {
      return orderedResults;
    }
  }

  return orderedResults;
}

function compareRerankResults(left: RerankResult, right: RerankResult): number {
  const scoreComparison = right.relevanceScore - left.relevanceScore;

  return scoreComparison === 0 ? left.index - right.index : scoreComparison;
}

function validateNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
}
