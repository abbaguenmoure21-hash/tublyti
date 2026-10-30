import { NextRequest, NextResponse } from 'next/server';

/**
 * CORS headers for the Chrome extension API routes.
 * Allows any chrome-extension:// origin (we validate via api_tokens, not origin).
 */
function isAllowedOrigin(origin: string): boolean {
  const appUrls = [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SITE_URL].filter(Boolean);
  if (appUrls.includes(origin)) return true;
  if (!origin.startsWith('chrome-extension://')) return false;
  // Optional allow-list (comma-separated chrome-extension://<id>): defence in depth once the
  // extension ID is known. Without it, any extension origin is accepted (auth stays token-based).
  const allowList = (process.env.EXT_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return allowList.length === 0 || allowList.includes(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    // The allowed origin is echoed back: caches must key on it.
    Vary: 'Origin',
  };

  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

/**
 * Handle OPTIONS preflight requests for extension API routes.
 */
export function handleCors(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  return null;
}

/**
 * Wrap a JSON response with CORS headers.
 */
export function jsonWithCors(
  request: NextRequest,
  body: unknown,
  init?: { status?: number },
): NextResponse {
  const origin = request.headers.get('origin');
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: corsHeaders(origin),
  });
}
