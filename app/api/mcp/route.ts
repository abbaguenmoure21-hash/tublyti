import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (token !== process.env.MCP_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // TODO: Phase 5 — MCP server implementation
  return NextResponse.json({ ok: true, status: 'not_implemented' });
}
