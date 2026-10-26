import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { appOrigin } from './session';
export const random = () => randomBytes(32).toString('base64url');
export const challenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
export async function provider() {
  const issuer = process.env.OIDC_ISSUER, clientId = process.env.OIDC_CLIENT_ID;
  if (!issuer?.startsWith('https://') || !clientId) throw new Error('Configure the OIDC issuer and client.');
  const response = await fetch(issuer.replace(/\/$/, '') + '/.well-known/openid-configuration', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Provider unavailable');
  const metadata = await response.json() as Record<string, unknown>;
  if (metadata.issuer !== issuer) throw new Error('Issuer mismatch');
  for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (typeof metadata[field] !== 'string' || !metadata[field].startsWith('https://')) throw new Error('Invalid provider metadata');
  }
  return { issuer, clientId, authorization: metadata.authorization_endpoint as string, token: metadata.token_endpoint as string, jwks: metadata.jwks_uri as string, redirectUri: appOrigin() + '/api/auth/callback' };
}
export async function exchange(code: string, verifier: string, nonce: string) {
  const config = await provider();
  const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, code, redirect_uri: config.redirectUri, code_verifier: verifier });
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  const secret = process.env.OIDC_CLIENT_SECRET;
  if (secret) {
    if (process.env.OIDC_TOKEN_AUTH_METHOD === 'client_secret_post') body.set('client_secret', secret);
    else headers.authorization = 'Basic ' + Buffer.from(encodeURIComponent(config.clientId) + ':' + encodeURIComponent(secret)).toString('base64');
  }
  const response = await fetch(config.token, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Token exchange failed');
  const token = await response.json() as { access_token?: string; id_token?: string; expires_in?: number; token_type?: string };
  if (!token.id_token || !token.access_token || token.access_token.length > 8192 || token.token_type?.toLowerCase() !== 'bearer') throw new Error('Invalid token response');
  const { payload } = await jwtVerify(token.id_token, createRemoteJWKSet(new URL(config.jwks), { timeoutDuration: 3000 }), { issuer: config.issuer, audience: config.clientId, algorithms: ['RS256', 'ES256', 'PS256'], requiredClaims: ['sub', 'exp', 'iat'] });
  if (payload.nonce !== nonce) throw new Error('Login nonce mismatch');
  return { access_token: token.access_token, seconds: Math.max(1, Math.min(3600, Number.isFinite(token.expires_in) ? token.expires_in! : 900)) };
}
