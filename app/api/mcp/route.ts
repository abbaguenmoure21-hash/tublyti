import { NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp/server';
import { authenticateToken } from '@/lib/mcp/auth';

// Long-running (YouTube collection, AI batches, Gemini video analysis): explicit Vercel limit.
// Internal deadlines (MAX_DURATION_MS = 4 min) keep >= 20 s of margin for finish/releaseLock.
export const maxDuration = 300;

async function handleMcp(request: NextRequest): Promise<Response> {
  const rawToken = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];

  if (!rawToken) {
    return new Response(
      JSON.stringify({ error: 'Token manquant. Ajoute Authorization: Bearer tly_xxx dans l\'en-tete.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const tokenInfo = await authenticateToken(rawToken);

  if (!tokenInfo) {
    return new Response(
      JSON.stringify({ error: 'Token invalide ou revoque. Cree un nouveau jeton dans Reglages > Connexion a Claude.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — serverless-compatible
    enableJsonResponse: true,
  });

  const server = createMcpServer(tokenInfo);
  await server.connect(transport);

  return transport.handleRequest(request as unknown as Request);
}

export async function GET(request: NextRequest): Promise<Response> {
  return handleMcp(request);
}

export async function POST(request: NextRequest): Promise<Response> {
  return handleMcp(request);
}

export async function DELETE(request: NextRequest): Promise<Response> {
  return handleMcp(request);
}
