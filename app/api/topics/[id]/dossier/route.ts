import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fetchDossierData, renderDossierMarkdown } from '@/lib/dossier/generate';

const uuidSchema = z.string().uuid();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });
  }

  const data = await fetchDossierData(id);
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
