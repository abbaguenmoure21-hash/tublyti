import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { handleCors, jsonWithCors } from '@/lib/ext/cors';
import { authenticateExtRequest, isAuthError } from '@/lib/ext/auth';
import { canWrite } from '@/lib/mcp/auth';

const bodySchema = z.object({
  action: z.enum(['mark_production', 'generate_angles', 'save_favorite']),
  topic_id: z.string().uuid(),
});

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? jsonWithCors(request, null, { status: 204 });
}

export async function POST(request: NextRequest) {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  const auth = await authenticateExtRequest(request);
  if (isAuthError(auth)) return auth;

  if (!canWrite(auth)) {
    return jsonWithCors(request, { error: 'Jeton en lecture seule.' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors(request, { error: 'Corps JSON invalide.' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonWithCors(request, { error: 'Parametres invalides.' }, { status: 400 });
  }

  const { action, topic_id } = parsed.data;
  const db = createServiceClient();

  try {
    // Verify topic exists
    const { data: topic } = await db
      .from('topics')
      .select('id, label, status')
      .eq('id', topic_id)
      .single();

    if (!topic) {
      return jsonWithCors(request, { error: 'Sujet introuvable.' }, { status: 404 });
    }

    switch (action) {
      case 'mark_production': {
        await db.from('topics').update({ status: 'production' }).eq('id', topic_id);
        return jsonWithCors(request, { ok: true, message: `"${topic.label}" passe en production.` });
      }

      case 'save_favorite': {
        await db.from('topics').update({ status: 'saved' }).eq('id', topic_id);
        return jsonWithCors(request, { ok: true, message: `"${topic.label}" sauvegarde.` });
      }

      case 'generate_angles': {
        // Delegate to the existing angle generation API route
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
          ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

        const angleRes = await fetch(`${baseUrl}/api/topics/${topic_id}/angles`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.CRON_SECRET}`
          }
        });

        if (!angleRes.ok) {
          const err = await angleRes.json().catch(() => ({}));
          return jsonWithCors(
            request,
            { error: (err as { error?: string }).error ?? 'Erreur lors de la generation.' },
            { status: angleRes.status },
          );
        }

        const angleData = await angleRes.json() as { angles?: unknown[] };
        return jsonWithCors(request, {
          ok: true,
          message: `${angleData.angles?.length ?? 0} angles generes pour "${topic.label}".`,
          count: angleData.angles?.length ?? 0,
        });
      }

      default:
        return jsonWithCors(request, { error: 'Action inconnue.' }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur serveur.';
    return jsonWithCors(request, { error: msg }, { status: 500 });
  }
}
