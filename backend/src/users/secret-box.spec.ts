import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, readVaultKey, VAULT_KEY_BYTES } from './secret-box';

const key = randomBytes(VAULT_KEY_BYTES);

describe('secret-box', () => {
  it('produces a self-describing value carrying its own IV and tag', () => {
    const stored = encryptSecret('hunter2!!', key);
    const [scheme, iv, tag, ciphertext] = stored.split('$');

    expect(scheme).toBe('a256gcm');
    expect(Buffer.from(iv, 'base64')).toHaveLength(12);
    expect(Buffer.from(tag, 'base64')).toHaveLength(16);
    expect(Buffer.from(ciphertext, 'base64').length).toBeGreaterThan(0);
    // The plaintext must not be sitting in the stored string in any encoding.
    expect(stored).not.toContain('hunter2');
  });

  it('opens what it sealed, including non-ASCII', () => {
    expect(decryptSecret(encryptSecret('correct horse', key), key)).toBe('correct horse');
    expect(decryptSecret(encryptSecret('пароль-Ω-🍓', key), key)).toBe('пароль-Ω-🍓');
  });

  it('uses a fresh IV, so the same password never stores the same string twice', () => {
    expect(encryptSecret('same', key)).not.toEqual(encryptSecret('same', key));
  });

  // Every failure reads as "nothing stored", never as a throw: a rotated key
  // or a hand-edited row must degrade to "перевидайте пароль" in the UI, not
  // to a 500 on the owner's registry.
  it('returns null for a foreign key rather than throwing', () => {
    const stored = encryptSecret('secret', key);
    expect(decryptSecret(stored, randomBytes(VAULT_KEY_BYTES))).toBeNull();
  });

  it('returns null for a tampered ciphertext — GCM authenticates it', () => {
    const [scheme, iv, tag, ciphertext] = encryptSecret('secret', key).split('$');
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[0] ^= 0xff;
    expect(decryptSecret([scheme, iv, tag, bytes.toString('base64')].join('$'), key)).toBeNull();
  });

  it('returns null for a malformed or unknown-scheme value', () => {
    expect(decryptSecret('', key)).toBeNull();
    expect(decryptSecret('plain-text-password', key)).toBeNull();
    expect(decryptSecret('a128gcm$aaaa$bbbb$cccc', key)).toBeNull();
    expect(decryptSecret(encryptSecret('secret', key).split('$').slice(1).join('$'), key)).toBeNull();
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

  it('refuses a key of the wrong length rather than silently truncating it', () => {
    expect(readVaultKey(randomBytes(16).toString('base64'))).toBeNull();
    expect(readVaultKey(randomBytes(64).toString('base64'))).toBeNull();
  });
});
