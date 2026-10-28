import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchDossierData, renderDossierMarkdown } from '@/lib/dossier/generate';
import { createServiceClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/session';
import { resolveScope } from '@/lib/scope';
import { timingSafeCompare } from '@/lib/auth/timing-safe';

const uuidSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  // Authenticate: require logged-in user OR CRON_SECRET
  const authHeader = _request.headers.get('authorization');
  const isCron = authHeader && timingSafeCompare(authHeader, `Bearer ${process.env.CRON_SECRET}`);
  
  let userId: string | null = null;
  if (!isCron) {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 });
    }
    userId = user.id;
    // A client only exports topics of their own themes (same rule as the topic page).
    if (user.role !== 'admin') {
      const db = createServiceClient();
      const [{ niches: mine }, { data: t }] = await Promise.all([
        resolveScope(db, user.id),
        db.from('topics').select('niche_id').eq('id', id).maybeSingle(),
      ]);
      if (!t || !mine.some((n) => n.id === (t.niche_id as string))) {
        return NextResponse.json({ error: 'Sujet introuvable.' }, { status: 404 });
      }
    }
  }

  const data = await fetchDossierData(id, { userId });
  if (!data) {
    return NextResponse.json({ error: 'Sujet introuvable.' }, { status: 404 });
  }

  const markdown = renderDossierMarkdown(data);

  const format = _request.nextUrl.searchParams.get('format');

  if (format === 'md') {
    const filename = `dossier-${data.topic.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return NextResponse.json({ markdown });
}
