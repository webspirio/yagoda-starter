import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Reversible encryption for exactly ONE secret: the copy of a password the
 * network owner is allowed to read back (issue #11 — «бачити логін та пароль
 * кожного користувача»).
 *
 * THIS IS NOT THE LOGIN PATH AND MUST NEVER BECOME IT. `password-hashing.ts`
 * still owns `password_hash` and `CredentialsService.verify()` still checks
 * against scrypt — a one-way hash is what keeps a stolen dump useless. What
 * this module adds is a SECOND, deliberately reversible copy, because the
 * product asks the owner to read an operator's password back and a hash cannot
 * be un-hashed. The two never mix: the vault copy is never consulted when
 * verifying a login, and losing it locks nobody out.
 *
 * The trade is deliberate and bounded:
 *   - The key lives in `PASSWORD_VAULT_KEY`, in the environment, NEVER in the
 *     database. `pg_dump user_credentials` on its own reveals nothing.
 *   - No key configured means no copy is written and nothing reads back. That
 *     is the default, and it leaves the login path byte-for-byte unchanged.
 *   - AES-256-GCM with a fresh 96-bit IV per value and the tag stored beside
 *     it, so a tampered or foreign row fails to open instead of yielding
 *     garbage that would be shown to the owner as a password.
 *   - One reader only: `GET /users/:id/password`, owner-only and audited.
 *
 * Stored form: `a256gcm$<iv base64>$<tag base64>$<ciphertext base64>`.
 * Self-describing for the same reason the scrypt string is — a future scheme
 * can be added without a migration, because every value says what made it.
 */

/** AES-256. A key of any other length is refused, never stretched or cut. */
export const VAULT_KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SCHEME = 'a256gcm';

/**
 * Turn `PASSWORD_VAULT_KEY` into a key, or null when the vault is off.
 *
 * Null ONLY for an absent key: unset is how a deployment says "do not keep
 * readable passwords", and that is the default.
 *
 * A key that is PRESENT and unusable THROWS, and the throw is the point. The
 * alternative — returning null — is a clean boot in which every row reads
 * «перевидайте пароль» forever and reissuing does not help, because nothing
 * is ever sealed. `env.schema.ts` catches the same mistake earlier, at boot,
 * with the same byte-length rule; this is the check that cannot be bypassed by
 * a caller that reads `process.env` directly (the dev seed does).
 */
export function readVaultKey(raw: string | undefined | null): Buffer | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const key = Buffer.from(trimmed, 'base64');
  if (key.length !== VAULT_KEY_BYTES) {
    throw new Error(
      `PASSWORD_VAULT_KEY must be ${VAULT_KEY_BYTES} bytes in base64 ` +
        `(openssl rand -base64 32); got ${key.length}`,
    );
  }
  return key;
}

/**
 * `aad` — additional authenticated data — is NOT encrypted; it is mixed into
 * the tag, so opening a value with a different `aad` fails. Callers pass the
 * user id, which binds each sealed password to its row: a `password_enc`
 * copied from one user to another (a partial restore, a hand-edited table)
 * then fails to open instead of showing the owner A's password as B's, which
 * would have them read out a password that cannot log B in.
 */
export function encryptSecret(plain: string, key: Buffer, aad: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    SCHEME,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('$');
}

/**
 * Null — never a throw — for every failure: a rotated key, a value written by
 * a scheme this build does not know, a hand-edited row, a value that belongs
 * to a different user (see `aad` on `encryptSecret`). The caller shows
 * "перевидайте пароль", which is the honest answer in all of them, and a
 * corrupt row can never turn the owner's registry into a 500.
 */
export function decryptSecret(stored: string, key: Buffer, aad: string): string | null {
  const parts = stored.split('$');
  if (parts.length !== 4) return null;

  const [scheme, rawIv, rawTag, rawCiphertext] = parts;
  if (scheme !== SCHEME) return null;

  const iv = Buffer.from(rawIv, 'base64');
  const tag = Buffer.from(rawTag, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    // `final()` is what verifies the tag — dropping it would hand back
    // unauthenticated plaintext, which is the whole point of using GCM.
    return Buffer.concat([
      decipher.update(Buffer.from(rawCiphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
