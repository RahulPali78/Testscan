import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { KeyObject } from 'node:crypto';
import { DEVELOPMENT_ACCOUNTS, DEVELOPMENT_ISSUER } from '@veriqo/db/development';
import { digest, ProductError, type Credential } from '@veriqo/db/product';

export type AuthMode = 'development' | 'oidc' | 'cognito';
export type AuthConfig =
  | { mode: 'development'; secret: string; nodeEnv?: string; host?: string }
  | { mode: 'oidc'; issuer: string; audience: string; jwksUri: string }
  | { mode: 'cognito'; issuer: string; clientId: string; jwksUri: string };
export interface AuthGateway {
  mode: AuthMode;
  authenticate(header: unknown): Promise<Credential>;
  loginDevelopment(accountId: string): Promise<{ access_token: string; expires_at: number }>;
}
const unauthorized = () => new ProductError(401, 'UNAUTHORIZED', 'Sign in with a valid, unexpired credential.');
type VerificationKey = JWTVerifyGetKey | CryptoKey | KeyObject | Uint8Array;

export function createAuthGateway(config: AuthConfig, suppliedKey?: VerificationKey): AuthGateway {
  if (config.mode === 'development' &&
      (config.nodeEnv === 'production' || !['127.0.0.1', 'localhost', '::1'].includes(config.host ?? '127.0.0.1') || config.secret.length < 32)) {
    throw new Error('Development authentication requires a local listener and a random secret of at least 32 characters.');
  }
  if (config.mode !== 'development' && (!config.issuer.startsWith('https://') || !config.jwksUri.startsWith('https://'))) {
    throw new Error('Identity issuer and JWKS endpoints must use HTTPS.');
  }
  const key = suppliedKey ?? (config.mode === 'development'
    ? new TextEncoder().encode(config.secret)
    : createRemoteJWKSet(new URL(config.jwksUri), { timeoutDuration: 2000, cooldownDuration: 30000, cacheMaxAge: 600000 }));
  const issuer = config.mode === 'development' ? DEVELOPMENT_ISSUER : config.issuer;
  const options = {
    issuer,
    ...(config.mode === 'oidc' ? { audience: config.audience } : config.mode === 'development' ? { audience: 'veriqo-local-api' } : {}),
    algorithms: config.mode === 'development' ? ['HS256'] : config.mode === 'cognito' ? ['RS256'] : ['RS256', 'ES256', 'PS256'],
    requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5,
  };
  return {
    mode: config.mode,
    async authenticate(header) {
      if (typeof header !== 'string' || header.length > 8192) throw unauthorized();
      const match = /^Bearer ([^\s]+)$/.exec(header);
      const token = match?.[1];
      if (!token) throw unauthorized();
      if (/^vq_[A-Za-z0-9_-]{43}$/.test(token)) return { kind: 'service', token_hash: digest(token) };
      try {
        const result = typeof key === 'function'
          ? await jwtVerify(token, key, options)
          : await jwtVerify(token, key, options);
        const payload = result.payload;
        if (!payload.sub || payload.sub.length > 255 || payload.token_use === 'id') throw unauthorized();
        if (config.mode === 'cognito' && (payload.token_use !== 'access' || payload.client_id !== config.clientId)) throw unauthorized();
        const name = typeof payload.name === 'string' ? payload.name : payload.sub;
        return { kind: 'user', identity: { issuer, subject: payload.sub, display_name: name.slice(0, 120) } };
      } catch { throw unauthorized(); }
    },
    async loginDevelopment(accountId) {
      if (config.mode !== 'development') throw new ProductError(404, 'NOT_FOUND', 'Development sign-in is disabled.');
      const account = DEVELOPMENT_ACCOUNTS.find((entry) => entry.id === accountId);
      if (!account) throw unauthorized();
      const expiresAt = Math.floor(Date.now() / 1000) + 900;
      const token = await new SignJWT({ name: account.label })
        .setProtectedHeader({ alg: 'HS256' }).setIssuer(DEVELOPMENT_ISSUER).setAudience('veriqo-local-api')
        .setSubject(account.subject).setIssuedAt().setExpirationTime(expiresAt)
        .sign(new TextEncoder().encode(config.secret));
      return { access_token: token, expires_at: expiresAt };
    },
  };
}

export function authFromEnvironment(): AuthGateway {
  const mode = process.env.VERIQO_AUTH_MODE;
  if (mode === 'development') return createAuthGateway({
    mode, secret: process.env.VERIQO_DEV_AUTH_SECRET ?? '',
    nodeEnv: process.env.NODE_ENV ?? 'development', host: process.env.API_HOST ?? '127.0.0.1',
  });
  const issuer = process.env.OIDC_ISSUER, clientId = process.env.OIDC_CLIENT_ID;
  if ((mode === 'oidc' || mode === 'cognito') && issuer && clientId) {
    const jwksUri = process.env.OIDC_JWKS_URI ?? issuer.replace(/\/$/, '') + '/.well-known/jwks.json';
    if (mode === 'cognito') return createAuthGateway({ mode, issuer, clientId, jwksUri });
    const audience = process.env.OIDC_AUDIENCE;
    if (audience) return createAuthGateway({ mode, issuer, audience, jwksUri });
  }
  throw new Error('Configure VERIQO_AUTH_MODE and the required identity settings; authentication cannot be disabled.');
}
