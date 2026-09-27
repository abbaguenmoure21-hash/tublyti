import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // TODO: Phase 5 — angle generation implementation
  return NextResponse.json({ ok: true, topic_id: id, status: 'not_implemented' });
}
