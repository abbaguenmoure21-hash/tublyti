import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';

export interface McpTokenInfo {
  id: string;
  permission: 'read' | 'readwrite';
  name: string;
}

/**
 * Authenticate an MCP request using the api_tokens table.
 * Returns token info on success, null on failure.
 */
export async function authenticateToken(rawToken: string): Promise<McpTokenInfo | null> {
  if (!rawToken || !rawToken.startsWith('tly_')) return null;

  const hash = createHash('sha256').update(rawToken).digest('hex');
  const db = createServiceClient();

  const { data } = await db
    .from('api_tokens')
    .select('id, name, permission')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .single();

  if (!data) return null;

  // Update last_used_at (fire-and-forget)
  db.from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    id: data.id as string,
    permission: data.permission as 'read' | 'readwrite',
    name: data.name as string,
  };
}

/**
 * Check if a token has write permission.
 */
export function canWrite(token: McpTokenInfo): boolean {
  return token.permission === 'readwrite';
}
