import 'server-only';
import { createHash } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'veriqo_session';
export const FLOW_COOKIE = 'veriqo_login_flow';
export function appOrigin() {
  const url = new URL(process.env.VERIQO_APP_URL ?? 'http://127.0.0.1:3000');
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Configure an HTTPS VERIQO_APP_URL.');
  return url.origin;
}
function key() {
  const secret = process.env.VERIQO_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Configure a random VERIQO_SESSION_SECRET with at least 32 characters.');
  return createHash('sha256').update(secret).digest();
}
export async function seal(payload: Record<string, unknown>, audience: string, seconds: number) {
  return new EncryptJWT(payload).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuer('veriqo-web').setAudience(audience).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + seconds).encrypt(key());
}
export async function unseal(value: string, audience: string) {
  return (await jwtDecrypt(value, key(), { issuer: 'veriqo-web', audience, keyManagementAlgorithms: ['dir'], contentEncryptionAlgorithms: ['A256GCM'] })).payload;
}
export async function accessToken(): Promise<string | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try { const value = await unseal(cookie, 'session'); return typeof value.access_token === 'string' ? value.access_token : null; }
  catch { return null; }
}
export async function setCookie(name: string, value: string, seconds: number) {
  (await cookies()).set(name, value, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: seconds });
}
export function sameOrigin(request: Request) { return request.headers.get('origin') === appOrigin(); }
export function apiUrl(path: string) { return new URL(path, process.env.VERIQO_API_URL ?? 'http://127.0.0.1:4000'); }
export async function readBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length;
      if (size > 65536) { await reader.cancel(); throw new Error('Body too large'); }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}
export async function proxy(request: Request, path: string) {
  const headers = { 'cache-control': 'private, no-store' };
  try {
    if (!['GET', 'HEAD'].includes(request.method) && !sameOrigin(request)) return Response.json({ message: 'Request origin is not allowed.' }, { status: 403, headers });
    const token = await accessToken();
    if (!token) return Response.json({ message: 'Sign in to continue.' }, { status: 401, headers });
    let body: string | undefined;
    if (!['GET', 'HEAD'].includes(request.method)) {
      try { body = await readBody(request); } catch { return Response.json({ message: 'Keep requests below 64 KiB.' }, { status: 413, headers }); }
    }
    const response = await fetch(apiUrl(path), {
      method: request.method, headers: { authorization: 'Bearer ' + token,
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(request.headers.has('idempotency-key') ? { 'idempotency-key': request.headers.get('idempotency-key')! } : {}) },
      body: body || null, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    const download = response.headers.get('content-disposition');
    return new Response(response.status === 204 ? null : await response.text(), { status: response.status, headers: {
      ...headers, 'content-type': 'application/json', ...(download ? { 'content-disposition': download } : {}),
    } });
  } catch { return Response.json({ message: 'The control API is unavailable. Retry when services recover.' }, { status: 503, headers }); }
}
