import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, readVaultKey, VAULT_KEY_BYTES } from './secret-box';

const key = randomBytes(VAULT_KEY_BYTES);
/** Every sealed value is bound to a user id; these two stand in for two rows. */
const owner = 'user-1';
const other = 'user-2';

describe('secret-box', () => {
  it('produces a self-describing value carrying its own IV and tag', () => {
    const stored = encryptSecret('hunter2!!', key, owner);
    const [scheme, iv, tag, ciphertext] = stored.split('$');

    expect(scheme).toBe('a256gcm');
    expect(Buffer.from(iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(tag, 'base64')).toHaveLength(16);
    expect(Buffer.from(ciphertext, 'base64').length).toBeGreaterThan(0);
    // The plaintext must not be sitting in the stored string in any encoding.
    expect(stored).not.toContain('hunter2');
  });

  it('opens what it sealed, including non-ASCII', () => {
    expect(decryptSecret(encryptSecret('correct horse', key, owner), key, owner)).toBe(
      'correct horse',
    );
    expect(decryptSecret(encryptSecret('пароль-Ω-🍓', key, owner), key, owner)).toBe('пароль-Ω-🍓');
  });

  it('uses a fresh IV, so the same password never stores the same string twice', () => {
    expect(encryptSecret('same', key, owner)).not.toEqual(encryptSecret('same', key, owner));
  });

  // Every failure reads as "nothing stored", never as a throw: a rotated key
  // or a hand-edited row must degrade to "перевидайте пароль" in the UI, not
  // to a 500 on the owner's registry.
  it('returns null for a foreign key rather than throwing', () => {
    const stored = encryptSecret('secret', key, owner);
    expect(decryptSecret(stored, randomBytes(VAULT_KEY_BYTES), owner)).toBeNull();
  });

  it('returns null for a tampered ciphertext — GCM authenticates it', () => {
    const [scheme, iv, tag, ciphertext] = encryptSecret('secret', key, owner).split('$');
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[0] ^= 0xff;
    expect(
      decryptSecret([scheme, iv, tag, bytes.toString('base64')].join('$'), key, owner),
    ).toBeNull();
  });

  // A row moved between users must not open. Otherwise the owner is shown one
  // person's password as another's and reads out something that cannot log
  // them in.
  it('refuses a value sealed for a different user', () => {
    const stored = encryptSecret('correct horse', key, owner);
    expect(decryptSecret(stored, key, other)).toBeNull();
    expect(decryptSecret(stored, key, owner)).toBe('correct horse');
  });

  it('returns null for a malformed or unknown-scheme value', () => {
    expect(decryptSecret('', key, owner)).toBeNull();
    expect(decryptSecret('plain-text-password', key, owner)).toBeNull();
    expect(decryptSecret('a128gcm$aaaa$bbbb$cccc', key, owner)).toBeNull();
    expect(
      decryptSecret(encryptSecret('secret', key, owner).split('$').slice(1).join('$'), key, owner),
    ).toBeNull();
  });
});

describe('readVaultKey', () => {
  it('decodes a 32-byte base64 key', () => {
    const raw = randomBytes(VAULT_KEY_BYTES).toString('base64');
    expect(readVaultKey(raw)).toEqual(Buffer.from(raw, 'base64'));
  });

  // Unset is the DEFAULT state of this feature, not an error: without a key
  // no reversible copy is written and none can be read.
  it('reads unset, empty and whitespace as "no vault"', () => {
    expect(readVaultKey(undefined)).toBeNull();
    expect(readVaultKey('')).toBeNull();
    expect(readVaultKey('   ')).toBeNull();
  });

  // A THROW, not a null: a key that is set but unusable must stop the process,
  // because the alternative is a clean boot where nothing is ever sealed and
  // every row reads «перевидайте пароль» forever.
  it('throws on a key of the wrong length rather than silently disabling the vault', () => {
    expect(() => readVaultKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => readVaultKey(randomBytes(64).toString('base64'))).toThrow(/32 bytes/);
    // 33 bytes is 44 base64 characters — the exact shape a character-count
    // rule waves through, which is why this check is here as well as in Joi.
    expect(() => readVaultKey(randomBytes(33).toString('base64'))).toThrow(/32 bytes/);
  });
});
