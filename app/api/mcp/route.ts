import { NextRequest } from 'next/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from '@/lib/mcp/server';

function authenticate(request: NextRequest): boolean {
  const token =
    request.headers.get('authorization')?.replace('Bearer ', '') ??
    request.nextUrl.searchParams.get('token');
  return token === process.env.MCP_TOKEN;
}

async function handleMcp(request: NextRequest): Promise<Response> {
  if (!authenticate(request)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — serverless-compatible
    enableJsonResponse: true,
  });

  const server = createMcpServer();
  await server.connect(transport);

  const response = await transport.handleRequest(request as unknown as Request);

  return response;
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
