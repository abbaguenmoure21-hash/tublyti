import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { handleCors, jsonWithCors } from '@/lib/ext/cors';
import { authenticateExtRequest, isAuthError } from '@/lib/ext/auth';
import { canWrite } from '@/lib/mcp/auth';
import { resolveNiche } from '@/lib/niches/resolve';

const bodySchema = z.object({
  channel_id: z.string().trim().regex(/^UC[\w-]{22}$/),
  niche: z.string().trim().min(1).max(100),
});

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? jsonWithCors(request, null, { status: 204 });
}

export async function POST(request: NextRequest) {
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  const auth = await authenticateExtRequest(request);
  if (isAuthError(auth)) return auth;

  if (!auth.isAdmin) {
    return jsonWithCors(request, { error: 'Le suivi de nouvelles chaînes est géré par l’équipe TubLyTI.' }, { status: 403 });
  }
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

  const { channel_id, niche } = parsed.data;
  const db = createServiceClient();

  try {
    // '_candidates' (extension addCandidate): goes to the candidate_channels review queue,
    // never to a niche of that name.
    if (niche === '_candidates') {
      const { error: candErr } = await db
        .from('candidate_channels')
        .upsert({ id: channel_id, discovered_via: 'extension' }, { onConflict: 'id', ignoreDuplicates: true });
      if (candErr) {
        console.error('[ext:track-channel] candidate insert failed', candErr);
        return jsonWithCors(request, { error: 'Impossible d\'ajouter la chaine.' }, { status: 500 });
      }
      return jsonWithCors(request, { ok: true, message: 'Chaine proposee.' });
    }

    // Existing niche only: a typo must not create a ghost niche (visible everywhere, collected every night).
    const { data: allNiches } = await db.from('niches').select('id, name, category, owner_channel');
    const resolved = resolveNiche(niche, (allNiches ?? []) as { id: string; name: string; category: string | null; owner_channel: string | null }[]);
    if (!resolved.niche) {
      return jsonWithCors(
        request,
        { error: 'Thematique introuvable.', code: 'niche_not_found', available: resolved.available },
        { status: 404 },
      );
    }
    const nicheId = resolved.niche.id;

    // Check if channel already exists
    const { data: existing } = await db
      .from('channels')
      .select('id')
      .eq('id', channel_id)
      .single();

    if (existing) {
      // Update niche_id
      await db.from('channels').update({ niche_id: nicheId }).eq('id', channel_id);
      return jsonWithCors(request, { ok: true, message: 'Chaine mise a jour.' });
    }

    // Insert new channel
    const { error: insertError } = await db.from('channels').insert({
      id: channel_id,
      niche_id: nicheId,
    });

    if (insertError) {
      return jsonWithCors(request, { error: 'Impossible d\'ajouter la chaine.' }, { status: 500 });
    }

    return jsonWithCors(request, { ok: true, message: 'Chaine ajoutee.' });
  } catch (e) {
    console.error('[ext:track-channel]', e);
    return jsonWithCors(request, { error: 'Erreur serveur.' }, { status: 500 });
  }
}
