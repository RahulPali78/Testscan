import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import { createAuthGateway } from '../src/auth.js';
import { digest } from '@veriqo/db/product';

test('development credentials are signed, bounded and refused outside local development', async () => {
  assert.throws(() => createAuthGateway({ mode: 'development', secret: 'x'.repeat(48), nodeEnv: 'production' }));
  assert.throws(() => createAuthGateway({ mode: 'development', secret: 'x'.repeat(48), host: '0.0.0.0' }));
  assert.throws(() => createAuthGateway({ mode: 'development', secret: 'weak' }));
  const auth = createAuthGateway({ mode: 'development', secret: 'x'.repeat(48) });
  const login = await auth.loginDevelopment('developer');
  const result = await auth.authenticate('Bearer ' + login.access_token);
  assert.equal(result.kind, 'user');
  assert.ok(login.expires_at <= Date.now() / 1000 + 901);
  await assert.rejects(auth.authenticate(undefined));
  await assert.rejects(auth.authenticate('Bearer ' + login.access_token.slice(0, -4) + 'xxxx'));
  await assert.rejects(auth.loginDevelopment('invented-admin'));
  const service = 'vq_' + 'a'.repeat(43);
  assert.deepEqual(await auth.authenticate('Bearer ' + service), { kind: 'service', token_hash: digest(service) });
});

test('OIDC and Cognito verify signatures and intended recipient rather than role or tenant claims', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const issuer = 'https://identity.example.test';
  const sign = (claims: Record<string, unknown>, audience = 'veriqo', expires: number = Math.floor(Date.now() / 1000) + 60) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer).setAudience(audience).setSubject('customer').setIssuedAt().setExpirationTime(expires).sign(privateKey);
  const auth = createAuthGateway({ mode: 'oidc', issuer, audience: 'veriqo', jwksUri: issuer + '/keys' }, publicKey);
  assert.deepEqual(await auth.authenticate('Bearer ' + await sign({ role: 'owner', organisation_id: 'other-tenant' })), {
    kind: 'user', identity: { issuer, subject: 'customer', display_name: 'customer' },
  });
  await assert.rejects(auth.authenticate('Bearer ' + await sign({}, 'another-api')));
  await assert.rejects(auth.authenticate('Bearer ' + await sign({}, 'veriqo', Math.floor(Date.now() / 1000) - 60)));
  await assert.rejects(auth.authenticate('Bearer ' + await sign({ token_use: 'id' })));
  const cognito = createAuthGateway({ mode: 'cognito', issuer, clientId: 'web-client', jwksUri: issuer + '/keys' }, publicKey);
  assert.equal((await cognito.authenticate('Bearer ' + await sign({ token_use: 'access', client_id: 'web-client' }))).kind, 'user');
  await assert.rejects(cognito.authenticate('Bearer ' + await sign({ token_use: 'access', client_id: 'wrong-client' })));
  await assert.rejects(cognito.authenticate('Bearer ' + await sign({ token_use: 'id', client_id: 'web-client' })));
  await assert.rejects(auth.loginDevelopment('developer'));
});
