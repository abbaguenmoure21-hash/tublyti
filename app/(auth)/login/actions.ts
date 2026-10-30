'use server';

import { createClient } from '@/lib/supabase/server';

// Legacy action (only used by the stray "page 2.tsx" copy, to be deleted).
// The real closure of sign-ups is the Supabase setting "Allow new users to sign up" = off
// (see README): this env guard alone cannot stop a direct signUp call with the public anon key.
export async function signup(email: string, password: string) {
  if (process.env.ALLOW_SIGNUP !== 'true') {
    return { error: "Les inscriptions sont fermées pour l'instant." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    // Never show the raw (English) provider message, and never reveal whether the address exists.
    return { error: "Impossible de créer le compte pour l'instant. Réessaie plus tard." };
  }

  return { error: null };
}
