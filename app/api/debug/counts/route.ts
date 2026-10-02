import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  // Authenticate: require a logged-in user
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  
  const { count: channelsCount } = await db.from('channels').select('*', { count: 'exact', head: true });
  const { count: candidatesCount } = await db.from('candidate_channels').select('*', { count: 'exact', head: true });
  
  const { data: statuses } = await db.from('candidate_channels').select('status');
  const statusCounts = (statuses || []).reduce((acc: Record<string, number>, curr) => {
    acc[curr.status] = (acc[curr.status] || 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    channelsCount,
    candidatesCount,
    statusCounts
  });
}
