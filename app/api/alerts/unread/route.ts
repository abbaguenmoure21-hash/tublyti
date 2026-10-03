import { NextResponse } from 'next/server';
import { getUnreadAlertCount } from '@/lib/actions/alerts';
import { getSessionUser } from '@/lib/auth/session';

/** Nombre d'alertes non lues du compte connecté. */
export async function GET() {
  // Route exclue du middleware : authentification vérifiée ici.
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const count = await getUnreadAlertCount();
  return NextResponse.json({ count });
}
