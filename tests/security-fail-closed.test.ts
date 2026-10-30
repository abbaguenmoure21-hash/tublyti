import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Fake Supabase service client: one canned result per table (or per table+select) ──
type Result = { data: unknown; error: { code: string; message?: string } | null };
let tables: Record<string, Result | ((columns: string) => Result)> = {};

function builder(table: string) {
  let columns = '';
  const resolve = (): Result => {
    const entry = tables[table];
    if (!entry) return { data: null, error: null };
    return typeof entry === 'function' ? entry(columns) : entry;
  };
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ['eq', 'is', 'neq', 'not', 'order', 'limit', 'update', 'in']) b[m] = chain;
  b.select = (cols: string) => {
    columns = cols;
    return b;
  };
  b.maybeSingle = async () => resolve();
  b.single = async () => resolve();
  b.then = (ok: (r: Result) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, ko);
  return b;
}

const fakeDb = {
  from: (table: string) => builder(table),
  auth: { admin: { getUserById: async () => ({ data: { user: null } }), listUsers: async () => ({ data: { users: [] } }) } },
};

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => fakeDb,
  createClient: async () => fakeDb,
}));

const listScopeNiches = vi.fn(async () => [{ id: 'niche-a' }]);
vi.mock('@/lib/scope', () => ({ listScopeNiches: (...args: unknown[]) => listScopeNiches(...(args as [])) }));

const { isMissingSchemaError } = await import('@/lib/auth/session');
const { authenticateToken } = await import('@/lib/mcp/auth');

describe('isMissingSchemaError (F1)', () => {
  it('only treats missing column/table codes as "old schema"', () => {
    expect(isMissingSchemaError({ code: '42703' })).toBe(true);
    expect(isMissingSchemaError({ code: 'PGRST204' })).toBe(true);
    expect(isMissingSchemaError({ code: '42P01' })).toBe(true);
  });
  it('never treats transient errors as "old schema"', () => {
    expect(isMissingSchemaError({ code: '57014' })).toBe(false); // statement_timeout
    expect(isMissingSchemaError({ code: '' })).toBe(false); // network / fetch failure
    expect(isMissingSchemaError({ code: '53300' })).toBe(false); // too many connections
    expect(isMissingSchemaError(null)).toBe(false);
  });
});

describe('authenticateToken (F2)', () => {
  beforeEach(() => {
    tables = {};
    listScopeNiches.mockClear();
  });

  it('refuses the token when api_tokens read fails with a transient error', async () => {
    tables.api_tokens = { data: null, error: { code: '57014' } };
    expect(await authenticateToken('tly_abc')).toBeNull();
  });

  it("gives a client's token no admin rights and only its niches", async () => {
    tables.api_tokens = { data: { id: 't1', name: 'x', permission: 'read', user_id: 'u-client' }, error: null };
    tables.profiles = { data: { role: 'client' }, error: null };
    const info = await authenticateToken('tly_abc');
    expect(info).not.toBeNull();
    expect(info?.isAdmin).toBe(false);
    expect(info?.nicheIds).toEqual(['niche-a']);
  });

  it('refuses the token when the profile read fails (never defaults to admin)', async () => {
    tables.api_tokens = { data: { id: 't1', name: 'x', permission: 'read', user_id: 'u-client' }, error: null };
    tables.profiles = { data: null, error: { code: '57014' } };
    expect(await authenticateToken('tly_abc')).toBeNull();
  });

  it('gives admin rights only to an admin profile', async () => {
    tables.api_tokens = { data: { id: 't1', name: 'x', permission: 'readwrite', user_id: 'u-admin' }, error: null };
    tables.profiles = { data: { role: 'admin' }, error: null };
    const info = await authenticateToken('tly_abc');
    expect(info?.isAdmin).toBe(true);
    expect(info?.nicheIds).toBeNull();
  });

  it('refuses a legacy token whose owner cannot be resolved', async () => {
    tables.api_tokens = { data: { id: 't1', name: 'x', permission: 'read', user_id: null }, error: null };
    tables.profiles = { data: [], error: null };
    tables.user_channels = { data: [], error: null };
    expect(await authenticateToken('tly_abc')).toBeNull();
  });

  it('rejects tokens without the tly_ prefix', async () => {
    expect(await authenticateToken('abc')).toBeNull();
  });
});
