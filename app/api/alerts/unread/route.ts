import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  // This route is excluded from middleware — authenticate manually
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  const { count } = await db
    .from('alert_events')
    .select('*', { count: 'exact', head: true })
    .eq('read', false);

  return NextResponse.json({ count: count ?? 0 });
}
