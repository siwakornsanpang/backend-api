import { createPublicKey, verify as verifySignature } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

const DEV_PUBLIC_JWK = {
  crv: 'Ed25519',
  x: 'GMN4Qz0izhAUxD8gLgU0PPkb_iIC48-MwLFG3fUTG0Q',
  kty: 'OKP',
  kid: 'pharmacy-web-dev-1',
  use: 'sig',
  alg: 'EdDSA',
} as const;

export interface PharmacyAssertionIdentity {
  subject: string;
  pharmacistLicense: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

function decodePart(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function publicKeyConfig() {
  const configuredJwk = process.env.PHARMACY_ASSERTION_PUBLIC_JWK;
  if (process.env.NODE_ENV === 'production' && !configuredJwk) {
    throw new Error('PHARMACY_ASSERTION_PUBLIC_JWK is required in production');
  }
  const jwk = configuredJwk
    ? JSON.parse(configuredJwk) as typeof DEV_PUBLIC_JWK
    : DEV_PUBLIC_JWK;
  return {
    jwk,
    issuer: process.env.PHARMACY_ASSERTION_ISSUER ?? 'pharmacy-web',
    audience: 'pharmacy-academy-api',
    kid: process.env.PHARMACY_ASSERTION_KEY_ID ?? jwk.kid,
  };
}

export async function verifyPharmacyAssertion(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodePart(encodedHeader);
    const payload = decodePart(encodedPayload);
    if (!header || !payload || header.alg !== 'EdDSA' || header.typ !== 'JWT') throw new Error('Invalid token');

    const { jwk, issuer, audience, kid } = publicKeyConfig();
    if (header.kid !== kid) throw new Error('Invalid key');
    const validSignature = verifySignature(
      null,
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(encodedSignature, 'base64url'),
    );
    const now = Math.floor(Date.now() / 1000);
    const issuedAt = Number(payload.iat);
    const expiresAt = Number(payload.exp);
    const identity = {
      subject: payload.sub,
      pharmacistLicense: payload.pharmacistLicense,
      firstName: payload.firstName,
      lastName: payload.lastName,
      email: payload.email,
      phone: payload.phone,
    };
    const validIdentity = typeof identity.subject === 'string' && identity.subject.length > 0
      && typeof identity.pharmacistLicense === 'string' && identity.pharmacistLicense.length > 0
      && typeof identity.firstName === 'string' && typeof identity.lastName === 'string'
      && (identity.email === null || typeof identity.email === 'string')
      && (identity.phone === null || typeof identity.phone === 'string');

    if (!validSignature || payload.iss !== issuer || payload.aud !== audience || !validIdentity
      || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
      || typeof payload.jti !== 'string' || !payload.jti
      || issuedAt > now + 30 || expiresAt <= now || expiresAt - issuedAt > 120) {
      throw new Error('Invalid assertion');
    }

    (request as FastifyRequest & { pharmacyIdentity?: PharmacyAssertionIdentity }).pharmacyIdentity = identity as PharmacyAssertionIdentity;
  } catch {
    return reply.status(401).send({ message: 'Unauthorized: Pharmacy session ไม่ถูกต้องหรือหมดอายุ' });
  }
}

export function getPharmacyAssertionIdentity(request: FastifyRequest): PharmacyAssertionIdentity {
  return (request as FastifyRequest & { pharmacyIdentity: PharmacyAssertionIdentity }).pharmacyIdentity;
}
