import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { handleCors, jsonWithCors } from '@/lib/ext/cors';
import { authenticateExtRequest, isAuthError } from '@/lib/ext/auth';
import { canWrite } from '@/lib/mcp/auth';
import { escapeLike } from '@/lib/utils';

const bodySchema = z.object({
  channel_id: z.string().min(1),
  niche: z.string().min(1),
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

  const { channel_id, niche } = parsed.data;
  const db = createServiceClient();

  try {
    // Find or create niche
    let nicheId: string;
    const { data: existingNiche } = await db
      .from('niches')
      .select('id')
      .ilike('name', escapeLike(niche))
      .single();

    if (existingNiche) {
      nicheId = existingNiche.id;
    } else {
      const { data: newNiche, error: nicheError } = await db
        .from('niches')
        .insert({ name: niche })
        .select('id')
        .single();

      if (nicheError || !newNiche) {
        return jsonWithCors(request, { error: 'Impossible de creer la niche.' }, { status: 500 });
      }
      nicheId = newNiche.id;
    }

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
  } catch {
    return jsonWithCors(request, { error: 'Erreur serveur.' }, { status: 500 });
  }
}
