import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_NEXT, safeNext } from '@/lib/safe-next';

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If not logged in and trying to access protected routes, redirect to login
  const path = request.nextUrl.pathname;
  const isPublic = path === '/' || path === '/liste-attente' || path === '/confidentialite' || path === '/robots.txt' || path === '/sitemap.xml' || path.startsWith('/login') || path.startsWith('/auth/');

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Remember the requested page so the login can bring the user back to it.
    url.search = '';
    url.searchParams.set('next', safeNext(path + request.nextUrl.search, request.nextUrl.origin));
    return NextResponse.redirect(url);
  }

  // Logged-in users skip the login page and the landing page.
  // /login/reset stays reachable: a signed-in user may still want to change their password.
  if (user && (path === '/login' || path === '/')) {
    const target = path === '/login' ? safeNext(request.nextUrl.searchParams.get('next'), request.nextUrl.origin) : DEFAULT_NEXT;
    return NextResponse.redirect(new URL(target, request.nextUrl.origin));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/cron|api/mcp|api/ext|api/topics|api/alerts|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
