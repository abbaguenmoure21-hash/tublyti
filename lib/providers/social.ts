export interface SocialMention {
  source: 'reddit' | 'hn';
  count: number;
  date: string;
}

export interface SocialProvider {
  countMentions(
    query: string,
    source: 'reddit' | 'hn',
    nicheCategory?: string,
  ): Promise<SocialMention>;
}

export class FakeSocialProvider implements SocialProvider {
  async countMentions(_query: string, source: 'reddit' | 'hn'): Promise<SocialMention> {
    return {
      source,
      count: Math.round(Math.random() * 20),
      date: new Date().toISOString().slice(0, 10),
    };
  }
}
