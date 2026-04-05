import * as jose from 'jose';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';

const alg = 'HS256';

/** @typedef {{ sub: string, maxBytes: number, maxFiles: number, pwdHash?: string }} ShareClaims */

/**
 * @param {ShareClaims & { exp: string }} payload
 */
export async function signUploadToken(payload) {
  return new jose.SignJWT({
    typ: 'songpit-upload',
    maxBytes: payload.maxBytes,
    maxFiles: payload.maxFiles,
    ...(payload.pwdHash ? { pwdHash: payload.pwdHash } : {}),
  })
    .setProtectedHeader({ alg })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(payload.exp)
    .sign(config.jwtSecret);
}

/**
 * @param {string} token
 */
export async function verifyUploadToken(token) {
  const { payload } = await jose.jwtVerify(token, config.jwtSecret, {
    algorithms: [alg],
  });
  if (payload.typ !== 'songpit-upload') {
    throw new Error('Invalid token type');
  }
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) {
    throw new Error('Invalid subject');
  }
  return {
    sub,
    maxBytes: Number(payload.maxBytes),
    maxFiles: Number(payload.maxFiles),
    pwdHash: typeof payload.pwdHash === 'string' ? payload.pwdHash : undefined,
  };
}

export function randomSubdir() {
  return `drop-${randomBytes(12).toString('hex')}`;
}
