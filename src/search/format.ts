import type { SearchOutputFormat, SearchResult } from '../types.js';
import { notImplemented } from '../errors.js';

export type FormatSearchResultsOptions = {
  format: SearchOutputFormat;
};

export function formatSearchResults(results: readonly SearchResult[], options: FormatSearchResultsOptions): string {
  void results;
  void options;
  return notImplemented('search result formatting');
}
