import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

export function proxy(request: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new NextResponse('Admin not configured (set ADMIN_PASSWORD).', { status: 500 });
  }

  const expectedHeader = 'Basic ' + Buffer.from(`admin:${expected}`).toString('base64');
  const provided = request.headers.get('authorization') ?? '';

  const a = Buffer.from(provided);
  const b = Buffer.from(expectedHeader);
  const ok = a.length === b.length && timingSafeEqual(a, b);

  if (!ok) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="trace-pack admin"' },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
