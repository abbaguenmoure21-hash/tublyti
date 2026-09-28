import { NextRequest } from 'next/server';
import { authenticateToken, type McpTokenInfo } from '@/lib/mcp/auth';
import { jsonWithCors } from './cors';

/**
 * Authenticate an extension API request using Bearer token.
 * Returns the token info on success, or a NextResponse error on failure.
 */
export async function authenticateExtRequest(
  request: NextRequest,
): Promise<McpTokenInfo | ReturnType<typeof jsonWithCors>> {
  const raw = request.headers.get('authorization')?.replace('Bearer ', '');

  if (!raw) {
    return jsonWithCors(request, { error: 'Jeton manquant.' }, { status: 401 });
  }

  const info = await authenticateToken(raw);
  if (!info) {
    return jsonWithCors(request, { error: 'Jeton invalide ou revoque.' }, { status: 401 });
  }

  return info;
}

/**
 * Type guard to check if auth result is an error response.
 */
export function isAuthError(
  result: McpTokenInfo | ReturnType<typeof jsonWithCors>,
): result is ReturnType<typeof jsonWithCors> {
  return 'status' in result;
}
