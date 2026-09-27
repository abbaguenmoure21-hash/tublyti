import type { TrendPoint, TrendProvider } from './trends';

/**
 * SearchApi implementation — stub, not yet active.
 * Selected by TREND_PROVIDER=searchapi when ready.
 */
export class SearchApiTrendProvider implements TrendProvider {
  async getInterestOverTime(_query: string, _days = 90): Promise<TrendPoint[]> {
    throw new Error(
      'SearchApiTrendProvider is not yet implemented. Set TREND_PROVIDER=serpapi.',
    );
  }
}
