import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt cost parameters. Raising them is safe WITHOUT a migration: every
 * stored value carries the parameters it was created with (see the format
 * below), so old hashes keep verifying against their own cost while new ones
 * use the current defaults.
 *
 * maxmem must exceed 128 * N * r bytes (16 MiB at these values); Node's
 * default is 32 MiB, so it is passed explicitly to keep the two from drifting
 * apart the moment N is raised.
 */
export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const SCHEME = 'scrypt';

const maxmemFor = (n: number, r: number): number => Math.max(32 * 1024 * 1024, 256 * n * r);

/**
 * Stored form: `scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>`.
 *
 * Self-describing on purpose — the alternative (parameters implied by the
 * code that happens to be deployed) makes any future cost increase a
 * lock-out of every existing account.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: maxmemFor(SCRYPT_N, SCRYPT_R),
  });
  return [
    SCHEME,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/**
 * False — never a throw — for every failure: wrong password, malformed value,
 * unknown scheme, or a row still holding a plain-text password from before
 * this module existed. A throw here would turn a bad row into a 500 and would
 * distinguish "corrupt credential" from "wrong password" to an attacker.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [scheme, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (scheme !== SCHEME) return false;

  const n = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n <= 1 || r < 1 || p < 1) return false;

  const salt = Buffer.from(rawSalt, 'base64');
  const expected = Buffer.from(rawHash, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scrypt(plain, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: maxmemFor(n, r),
    });
    // Lengths are equal by construction (keylen === expected.length), but
    // timingSafeEqual throws on a mismatch, so the guard stays.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
