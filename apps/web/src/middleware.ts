import { NextResponse, type NextRequest } from 'next/server';

/**
 * Layouts cannot read the pathname, but two products share this deployment
 * (ADR-006) and the root layout has to know which one it is rendering. This
 * puts the path where the layout can see it.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static assets never need it.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
