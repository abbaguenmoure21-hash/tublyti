export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendProvider {
  getInterestOverTime(query: string, days?: number): Promise<TrendPoint[]>;
}

export class FakeTrendProvider implements TrendProvider {
  async getInterestOverTime(_query: string, days = 90): Promise<TrendPoint[]> {
    const points: TrendPoint[] = [];
    const now = Date.now();
    for (let i = 0; i < days; i++) {
      points.push({
        date: new Date(now - i * 86400000).toISOString().slice(0, 10),
        value: Math.round(50 + Math.random() * 50),
      });
    }
    return points;
  }
}
