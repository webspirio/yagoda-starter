import { scrypt as scryptCb, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { hashPassword, verifyPassword, SCRYPT_KEYLEN } from './password-hashing';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

describe('password-hashing', () => {
  it('produces a self-describing scrypt string carrying its own parameters', async () => {
    const stored = await hashPassword('hunter2!!');
    const [scheme, n, r, p, salt, hash] = stored.split('$');

    expect(scheme).toBe('scrypt');
    expect(Number(n)).toBe(16384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(hash, 'base64')).toHaveLength(SCRYPT_KEYLEN);
  });

  it('salts each hash, so the same password never stores the same string twice', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toEqual(b);
  });

  it('verifies the password it hashed', async () => {
    const stored = await hashPassword('correct horse');
    await expect(verifyPassword('correct horse', stored)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse');
    await expect(verifyPassword('correct horse ', stored)).resolves.toBe(false);
    await expect(verifyPassword('wrong', stored)).resolves.toBe(false);
  });

  // The stored format carries its own cost parameters precisely so they can be
  // raised later without a migration: an OLD hash must keep verifying against
  // the NEW defaults. Without this test, raising SCRYPT_N would silently lock
  // out every existing account.
  it('verifies a hash made with different parameters than the current defaults', async () => {
    const salt = randomBytes(16);
    const weakN = 1024;
    const key = await scrypt('legacy pw', salt, SCRYPT_KEYLEN, { N: weakN, r: 8, p: 1 });
    const stored = `scrypt$${weakN}$8$1$${salt.toString('base64')}$${key.toString('base64')}`;

    await expect(verifyPassword('legacy pw', stored)).resolves.toBe(true);
    await expect(verifyPassword('other pw', stored)).resolves.toBe(false);
  });

  // A malformed row must be a failed login, never a 500. The plain-text rows
  // this replaces look exactly like this, and so does any truncated value.
  it.each([
    ['', 'empty'],
    ['admin', 'a bare plain-text password'],
    ['scrypt$16384$8$1$onlyfivefields', 'too few fields'],
    ['bcrypt$16384$8$1$c2FsdA==$aGFzaA==', 'an unknown scheme'],
    ['scrypt$notanumber$8$1$c2FsdA==$aGFzaA==', 'a non-numeric cost'],
  ])('returns false rather than throwing for %s (%s)', async (stored) => {
    await expect(verifyPassword('anything', stored)).resolves.toBe(false);
  });
});
