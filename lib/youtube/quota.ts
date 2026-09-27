export class QuotaSoftLimitReached extends Error {
  constructor(used: number, limit: number) {
    super(`YouTube quota soft limit reached: ${used}/${limit}`);
    this.name = 'QuotaSoftLimitReached';
  }
}

export function getQuotaSoftLimit(): number {
  return parseInt(process.env.YT_QUOTA_SOFT_LIMIT ?? '8000', 10);
}
