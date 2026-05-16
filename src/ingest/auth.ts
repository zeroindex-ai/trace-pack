export function expectedTokenForSource(source: string): string | undefined {
  const key = 'SOURCE_TOKEN_' + source.toUpperCase().replace(/-/g, '_');
  return process.env[key];
}

export function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  return m ? (m[1] ?? null) : null;
}

export function authenticate(source: string, authHeader: string | null | undefined): boolean {
  const expected = expectedTokenForSource(source);
  if (!expected) return false;
  const provided = extractBearer(authHeader);
  if (!provided) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
