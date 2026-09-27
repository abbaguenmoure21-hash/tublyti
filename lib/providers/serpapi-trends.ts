import type { TrendPoint, TrendProvider } from './trends';

const SERPAPI_BASE = 'https://serpapi.com/search.json';
const TIMEOUT_MS = 10_000;

export class SerpApiTrendProvider implements TrendProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.SERPAPI_KEY ?? '';
    if (!this.apiKey) throw new Error('Missing SERPAPI_KEY');
  }

  async getInterestOverTime(query: string, days = 90): Promise<TrendPoint[]> {
    const dateParam = days <= 30 ? 'today 1-m' : days <= 90 ? 'today 3-m' : 'today 12-m';
    const url = new URL(SERPAPI_BASE);
    url.searchParams.set('engine', 'google_trends');
    url.searchParams.set('q', query);
    url.searchParams.set('data_type', 'TIMESERIES');
    url.searchParams.set('date', dateParam);
    url.searchParams.set('geo', 'US');
    url.searchParams.set('api_key', this.apiKey);

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`SerpApi error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const timeline = data?.interest_over_time?.timeline_data;

    if (!Array.isArray(timeline)) return [];

    return timeline.map(
      (point: { timestamp: string; values: { extracted_value: number }[] }) => ({
        date: new Date(parseInt(point.timestamp, 10) * 1000)
          .toISOString()
          .slice(0, 10),
        value: point.values?.[0]?.extracted_value ?? 0,
      }),
    );
  }
}
