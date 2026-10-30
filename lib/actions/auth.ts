'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side sign-out: clears the Supabase session cookies and sends the user to /login.
 * Keeps supabase-js out of the client bundle of every app page (the sidebar used to import
 * the browser client only for this).
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
