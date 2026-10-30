import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchDossierData, renderDossierMarkdown } from '@/lib/dossier/generate';
import { getSessionUser } from '@/lib/auth/session';
import { isCronAuthorized } from '@/lib/auth/cron';
import { canSeeTopic } from '@/lib/auth/topic-access';

const uuidSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  // Authenticate: logged-in user with access to the topic's niche, OR CRON_SECRET.
  const isCron = isCronAuthorized(_request.headers.get('authorization'));
  let viewerId: string | null = null;

  if (!isCron) {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé.' }, { status: 401 });
    }
    // Same rule as the topic page: a client only sees topics of its own niches.
    if (!(await canSeeTopic(user, id))) {
      return NextResponse.json({ error: 'Sujet introuvable.' }, { status: 404 });
    }
    viewerId = user.id;
  }

  const data = await fetchDossierData(id, { viewerId });
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
