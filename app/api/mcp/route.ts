import { NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp/server';
import { authenticateToken } from '@/lib/mcp/auth';

async function handleMcp(request: NextRequest): Promise<Response> {
  const rawToken = request.headers.get('authorization')?.replace('Bearer ', '');

  if (!rawToken) {
    return new Response(
      JSON.stringify({ error: 'Token manquant. Ajoute Authorization: Bearer tly_xxx dans l\'en-tete.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const tokenInfo = await authenticateToken(rawToken);

  if (!tokenInfo) {
    return new Response(
      JSON.stringify({ error: 'Token invalide ou revoque. Cree un nouveau jeton dans Reglages > Acces API.' }),
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
