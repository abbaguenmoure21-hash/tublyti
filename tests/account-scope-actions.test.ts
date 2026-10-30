import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fake service client: canned rows per table, records the niche ids asked for ──
type Row = Record<string, unknown>;
let videoRow: Row | null = null;
let nicheRows: { id: string; name: string }[] = [];
let userChannel: Row | null = null;

function builder(table: string) {
  const filters: { in?: string[] } = {};
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ['select', 'eq', 'not', 'is', 'order', 'limit', 'gte']) b[m] = chain;
  b.in = (_col: string, ids: string[]) => {
    filters.in = ids;
    return b;
  };
  const resolve = () => {
    if (table === 'videos') return { data: videoRow, error: null };
    if (table === 'user_channels') return { data: userChannel, error: null };
    if (table === 'niches') return { data: nicheRows.filter((n) => !filters.in || filters.in.includes(n.id)), error: null };
    return { data: null, error: null };
  };
  b.maybeSingle = async () => resolve();
  b.single = async () => resolve();
  b.then = (ok: (r: unknown) => unknown) => Promise.resolve(resolve()).then(ok);
  return b;
}
const fakeDb = { from: (t: string) => builder(t) };

let sessionUser: { id: string; role: 'admin' | 'client'; email: string; displayName: null } | null = null;
const scopeNiches = vi.fn(async () => [{ id: 'niche-mine' }, { id: 'niche-followed' }]);
type CompareArgs = [db: unknown, terms: string[], ids: string[] | null];
const compareKeywords = vi.fn<(...a: CompareArgs) => Promise<unknown>>(async () => ({ scope: 'niche', stats: [], winner: null, verdict: '' }));
const outlierSaturation = vi.fn(async () => ({ level: 'open' }));
const linkSaturation = vi.fn(async (): Promise<Record<string, unknown>> => ({ videoId: 'abcdefghijk', nicheName: 'Finance', inCatalog: false }));
const consumeUserQuota = vi.fn(async () => true);

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => fakeDb, createClient: async () => fakeDb }));
vi.mock('@/lib/auth/session', () => ({ getSessionUser: async () => sessionUser }));
vi.mock('@/lib/scope', () => ({ listScopeNiches: (...a: unknown[]) => scopeNiches(...(a as [])) }));
vi.mock('@/lib/keywords', () => ({ compareKeywords: (...a: unknown[]) => compareKeywords(...(a as CompareArgs)) }));
vi.mock('@/lib/saturation', () => ({
  outlierSaturation: (...a: unknown[]) => outlierSaturation(...(a as [])),
  linkSaturation: (...a: unknown[]) => linkSaturation(...(a as [])),
}));
vi.mock('@/lib/auth/user-quota', () => ({ consumeUserQuota: (...a: unknown[]) => consumeUserQuota(...(a as [])), QUOTA_MESSAGE: 'quota' }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('@/lib/youtube/public-stats', () => ({ getPublicStats: async () => null }));
vi.mock('@/lib/preflight/engine', () => ({ runPreflight: async () => ({ id: null, result: {} }) }));
vi.mock('@/lib/preflight/video-file', () => ({ fileState: async () => ({ state: 'ACTIVE' }), startUpload: async () => '' }));
vi.mock('@/lib/ai/gemini', () => ({ geminiEnabled: () => false }));

const { compareKeywordsAction } = await import('@/lib/actions/preflight');
const { checkOutlierSaturation, checkLinkSaturation } = await import('@/lib/actions/saturation');
const { keywordNicheFilter, OUT_OF_SCOPE_MESSAGE } = await import('@/lib/auth/account-scope');

const client = { id: 'u1', role: 'client' as const, email: 'c@x', displayName: null };
const admin = { id: 'a1', role: 'admin' as const, email: 'a@x', displayName: null };

beforeEach(() => {
  vi.clearAllMocks();
  videoRow = null;
  nicheRows = [
    { id: 'niche-mine', name: 'Finance' },
    { id: 'niche-followed', name: 'Psychologie' },
    { id: 'niche-other', name: 'Cuisine' },
  ];
  userChannel = { id: 'uc1', niche_id: 'niche-mine', youtube_channel_id: 'UCx', verified_at: '2026-01-01' };
});

describe('compareKeywordsAction scope (FINAL #1)', () => {
  it('a client asking scope "all" stays within its own niches, never the whole catalogue', async () => {
    sessionUser = client;
    await compareKeywordsAction('uc1', ['ai', 'etf'], 'all');
    const ids = compareKeywords.mock.calls[0][2];
    expect(ids).not.toBeNull();
    expect([...(ids ?? [])].sort()).toEqual(['niche-followed', 'niche-mine']);
  });

  it('an admin asking scope "all" reads the whole catalogue', async () => {
    sessionUser = admin;
    await compareKeywordsAction('uc1', ['ai', 'etf'], 'all');
    expect(compareKeywords.mock.calls[0][2]).toBeNull();
  });

  it('scope "niche" is the channel niche for everyone', async () => {
    sessionUser = client;
    await compareKeywordsAction('uc1', ['ai', 'etf'], 'niche');
    expect(compareKeywords.mock.calls[0][2]).toEqual(['niche-mine']);
  });

  it('a client without any niche gets an empty filter, not null', () => {
    expect(keywordNicheFilter('client', 'all', '', [])).toEqual(['00000000-0000-0000-0000-000000000000']);
  });
});

describe('saturation actions scope (FINAL #2)', () => {
  it('refuses a catalogue video of another niche for a client', async () => {
    sessionUser = client;
    videoRow = { channels: { niche_id: 'niche-other' } };
    const r = await checkOutlierSaturation('abcdefghijk');
    expect(r).toEqual({ ok: false, message: OUT_OF_SCOPE_MESSAGE });
    expect(outlierSaturation).not.toHaveBeenCalled();
  });

  it('accepts a catalogue video of the client niche', async () => {
    sessionUser = client;
    videoRow = { channels: { niche_id: 'niche-followed' } };
    const r = await checkOutlierSaturation('abcdefghijk');
    expect(r.ok).toBe(true);
  });

  it('lets an admin check any video', async () => {
    sessionUser = admin;
    videoRow = { channels: { niche_id: 'niche-other' } };
    expect((await checkOutlierSaturation('abcdefghijk')).ok).toBe(true);
  });

  it('link: refuses a catalogue video of another niche before spending the quota', async () => {
    sessionUser = client;
    videoRow = { channels: { niche_id: 'niche-other' } };
    const r = await checkLinkSaturation('https://youtu.be/abcdefghijk');
    expect(r).toEqual({ ok: false, message: OUT_OF_SCOPE_MESSAGE });
    expect(consumeUserQuota).not.toHaveBeenCalled();
    expect(linkSaturation).not.toHaveBeenCalled();
  });

  it('link: refuses an off-catalogue video whose detected niche is not the client one', async () => {
    sessionUser = client;
    linkSaturation.mockResolvedValueOnce({ videoId: 'abcdefghijk', nicheName: 'Cuisine', inCatalog: false });
    const r = await checkLinkSaturation('https://youtu.be/abcdefghijk');
    expect(r).toEqual({ ok: false, message: OUT_OF_SCOPE_MESSAGE });
  });

  it('link: accepts an off-catalogue video detected in a client niche', async () => {
    sessionUser = client;
    const r = await checkLinkSaturation('https://youtu.be/abcdefghijk');
    expect(r.ok).toBe(true);
  });

  it('link: an admin gets any detected niche', async () => {
    sessionUser = admin;
    linkSaturation.mockResolvedValueOnce({ videoId: 'abcdefghijk', nicheName: 'Cuisine', inCatalog: false });
    expect((await checkLinkSaturation('https://youtu.be/abcdefghijk')).ok).toBe(true);
  });
});
