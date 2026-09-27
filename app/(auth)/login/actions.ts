'use server';

import { createClient } from '@/lib/supabase/server';

export async function signup(email: string, password: string) {
  if (process.env.ALLOW_SIGNUP !== 'true') {
    return { error: "Les inscriptions sont fermées pour l'instant." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}
