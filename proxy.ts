import { NextRequest, NextResponse } from 'next/server';

function buildCsp({ enforceHttps }: { enforceHttps: boolean }) {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "font-src 'self' https://fonts.gstatic.com",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "connect-src 'self' https://api.openrouter.ai",
  ];

  if (enforceHttps) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const enforceHttps =
    process.env.NODE_ENV === 'production' && request.nextUrl.protocol === 'https:';

  response.headers.set('Content-Security-Policy', buildCsp({ enforceHttps }));
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};
