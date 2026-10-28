import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { timingSafeCompare } from '@/lib/auth/timing-safe';
import { generateAnglesForTopic } from '@/lib/services/angles';

// Claude Sonnet call: leave room beyond the default function timeout.
export const maxDuration = 60;

const uuidSchema = z.string().uuid();

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const authHeader = _request.headers.get('authorization');
  if (!timingSafeCompare(authHeader ?? '', `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 });
  }

  const res = await generateAnglesForTopic(createServiceClient(), id);
  if (!res.ok) {
    return NextResponse.json(
      {
        error: res.message,
        ...(res.budgetRemainingUSD !== undefined ? { budgetRemainingUSD: res.budgetRemainingUSD } : {}),
        ...(res.estimatedCostUSD !== undefined ? { estimatedCostUSD: res.estimatedCostUSD } : {}),
      },
      { status: res.status },
    );
  }

  return NextResponse.json({
    ok: true,
    angles: res.angles,
    model: res.model,
    costUSD: res.costUSD,
    budgetRemainingUSD: res.budgetRemainingUSD,
  });
}
