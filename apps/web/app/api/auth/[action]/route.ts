import { cookies } from 'next/headers';
import { SESSION_COOKIE, FLOW_COOKIE, apiUrl, appOrigin, seal, unseal, setCookie, sameOrigin, readBody, proxy } from '../../../../lib/session';
import { provider, random, challenge, exchange } from '../../../../lib/oidc';
export const dynamic = 'force-dynamic';
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'cache-control': 'private, no-store' } });
export async function GET(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  try {
    if (action === 'session') return proxy(request, '/v1/me');
    if (action === 'config') {
      const response = await fetch(apiUrl('/v1/auth/config'), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      return json(await response.json(), response.status);
    }
    if (action === 'login' && ['oidc', 'cognito'].includes(process.env.VERIQO_AUTH_MODE ?? '')) {
      const config = await provider();
      const state = random(), nonce = random(), verifier = random();
      await setCookie(FLOW_COOKIE, await seal({ state, nonce, verifier }, 'login-flow', 300), 300);
      const url = new URL(config.authorization);
      url.search = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri,
        scope: process.env.OIDC_SCOPES ?? 'openid profile', state, nonce, code_challenge: challenge(verifier), code_challenge_method: 'S256' }).toString();
      return Response.redirect(url, 303);
    }
    if (action === 'callback') {
      const jar = await cookies();
      const flowCookie = jar.get(FLOW_COOKIE)?.value;
      jar.delete(FLOW_COOKIE);
      if (!flowCookie) throw new Error('Missing login flow');
      const flow = await unseal(flowCookie, 'login-flow');
      const url = new URL(request.url);
      if (url.searchParams.get('state') !== flow.state || !url.searchParams.get('code') || typeof flow.verifier !== 'string' || typeof flow.nonce !== 'string') throw new Error('Invalid login state');
      const result = await exchange(url.searchParams.get('code')!, flow.verifier, flow.nonce);
      const me = await fetch(apiUrl('/v1/me'), { headers: { authorization: 'Bearer ' + result.access_token }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!me.ok) throw new Error('API rejected credential');
      await setCookie(SESSION_COOKIE, await seal({ access_token: result.access_token }, 'session', result.seconds), result.seconds);
      return Response.redirect(appOrigin(), 303);
    }
    return json({ message: 'Route unavailable.' }, 404);
  } catch {
    if (action === 'callback') return Response.redirect(appOrigin() + '/?signin=failed', 303);
    return json({ message: 'Sign-in service is unavailable. Check the configured identity provider.' }, 503);
  }
}
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  try {
    if (!sameOrigin(request)) return json({ message: 'Request origin is not allowed.' }, 403);
    if (action === 'logout') {
      const jar = await cookies(); jar.delete(SESSION_COOKIE); jar.delete(FLOW_COOKIE);
      return json({ signed_out: true });
    }
    if (action === 'development' && process.env.VERIQO_AUTH_MODE === 'development' && process.env.NODE_ENV !== 'production') {
      const response = await fetch(apiUrl('/v1/auth/development'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: await readBody(request), cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!response.ok) return json({ message: 'Development sign-in failed.' }, response.status);
      const result = await response.json() as { access_token: string; expires_at: number };
      const seconds = Math.min(900, result.expires_at - Math.floor(Date.now() / 1000));
      await setCookie(SESSION_COOKIE, await seal({ access_token: result.access_token }, 'session', seconds), seconds);
      return json({ signed_in: true });
    }
    return json({ message: 'Route unavailable.' }, 404);
  } catch { return json({ message: 'Sign-in service is unavailable.' }, 503); }
}
