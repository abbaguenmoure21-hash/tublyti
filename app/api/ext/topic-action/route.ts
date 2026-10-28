import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { handleCors, jsonWithCors } from '@/lib/ext/cors';
import { authenticateExtRequest, isAuthError } from '@/lib/ext/auth';
import { canWrite, canSeeNiche } from '@/lib/mcp/auth';
import { generateAnglesForTopic } from '@/lib/services/angles';

// generate_angles calls Claude Sonnet.
export const maxDuration = 60;

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
      .select('id, label, status, niche_id')
      .eq('id', topic_id)
      .single();

    if (!topic || !canSeeNiche(auth, topic.niche_id as string)) {
      return jsonWithCors(request, { error: 'Sujet introuvable.' }, { status: 404 });
    }

    switch (action) {
      case 'mark_production': {
        if (auth.userId) {
          // Nouvelle vidéo dans « Mes vidéos » du compte ; le sujet (commun) n'est pas modifié.
          const { error } = await db.from('angles').insert({ topic_id, title: topic.label, status: 'in_production', user_id: auth.userId });
          if (error) return jsonWithCors(request, { error: 'La vidéo n’a pas pu être créée.' }, { status: 500 });
        } else {
          await db.from('topics').update({ status: 'in_production' }).eq('id', topic_id);
        }
        return jsonWithCors(request, { ok: true, message: `"${topic.label}" ajouté à Mes vidéos.` });
      }

      case 'save_favorite': {
        let colQ = db.from('collections').select('id').eq('is_default', true);
        if (auth.userId) colQ = colQ.eq('user_id', auth.userId);
        let { data: col } = await colQ.limit(1).maybeSingle();
        if (!col && auth.userId) {
          ({ data: col } = await db.from('collections').insert({ name: 'Favoris', is_default: true, user_id: auth.userId }).select('id').single());
        }
        if (!col) return jsonWithCors(request, { error: 'Collection « Favoris » introuvable.' }, { status: 500 });
        await db
          .from('collection_items')
          .upsert({ collection_id: col.id, item_type: 'topic', ref_id: topic_id }, { onConflict: 'collection_id,item_type,ref_id' });
        return jsonWithCors(request, { ok: true, message: `"${topic.label}" ajouté aux favoris.` });
      }

      case 'generate_angles': {
        if (!auth.isAdmin) {
          return jsonWithCors(request, { error: 'La génération d’angles est faite par l’équipe TubLyTI.' }, { status: 403 });
        }
        // Direct call to the shared service (no internal HTTP round-trip, no secret sent around).
        const gen = await generateAnglesForTopic(db, topic_id);
        if (!gen.ok) {
          return jsonWithCors(request, { error: gen.message, code: gen.code }, { status: gen.status });
        }
        return jsonWithCors(request, {
          ok: true,
          message: `${gen.angles.length} angles generes pour "${topic.label}".`,
          count: gen.angles.length,
        });
      }

      default:
        return jsonWithCors(request, { error: 'Action inconnue.' }, { status: 400 });
    }
  } catch (e) {
    // Never echo internal (Postgres/exception) messages to the client.
    console.error('[ext:topic-action]', e);
    return jsonWithCors(request, { error: 'Petit souci de notre côté, réessaie dans un instant.' }, { status: 500 });
  }
}
