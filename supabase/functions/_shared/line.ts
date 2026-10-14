// Server-only helpers. Never import this module from browser code.
export function secret(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
export function serviceKey(): string {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
  if (typeof keys.default === 'string' && keys.default) return keys.default;
  throw new Error('Missing Supabase server key');
}
export function adminId(): string {
  const id = secret('LINE_ADMIN_USER_ID');
  if (!/^U[0-9a-f]{32}$/i.test(id)) throw new Error('Invalid LINE_ADMIN_USER_ID');
  return id;
}
export async function equalSecret(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all(
    [a, b].map((value) => crypto.subtle.digest('SHA-256', encoder.encode(value))),
  );
  const x = new Uint8Array(left),
    y = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
export async function readBody(request: Request, max = 262144): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new Error('Body too large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of chunks) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(bytes);
}
export async function verifySignature(body: string, signature: string): Promise<boolean> {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret('LINE_CHANNEL_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'HMAC',
    key,
    Uint8Array.from(atob(signature), (char) => char.charCodeAt(0)),
    encoder.encode(body),
  );
}
export async function database(path: string, method = 'GET', body?: unknown): Promise<any> {
  const key = serviceKey();
  const response = await fetch(secret('SUPABASE_URL') + path, {
    method,
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Database HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export async function lineRequest(
  path: string,
  body: unknown,
  retryKey?: string,
): Promise<Response> {
  return fetch('https://api.line.me/v2/bot/message/' + path, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + secret('LINE_CHANNEL_ACCESS_TOKEN'),
      'Content-Type': 'application/json',
      ...(retryKey ? { 'X-Line-Retry-Key': retryKey } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
}
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
