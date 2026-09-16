import { envValidationSchema } from './env.schema';

// The two keys with no default; every other rule has one.
const required = {
  APP_URL: 'https://yagoda.example.com',
  JWT_SECRET: 'x'.repeat(32),
};

// Mirror ConfigModule's defaults: unknown keys pass, all errors are collected.
function validate(env: Record<string, string>) {
  return envValidationSchema.validate({ ...required, ...env }, { allowUnknown: true, abortEarly: false });
}

describe('envValidationSchema', () => {
  it('treats empty BOOTSTRAP_OWNER_* as unset — docker-compose.prod.yml forwards them as ${VAR:-}', () => {
    const { error, value } = validate({
      BOOTSTRAP_OWNER_LOGIN: '',
      BOOTSTRAP_OWNER_PASSWORD: '',
      BOOTSTRAP_OWNER_FIRST_NAME: '',
      BOOTSTRAP_OWNER_LAST_NAME: '',
    });
    expect(error).toBeUndefined();
    expect(value.BOOTSTRAP_OWNER_LOGIN).toBeUndefined();
    expect(value.BOOTSTRAP_OWNER_PASSWORD).toBeUndefined();
  });

  it('still rejects a BOOTSTRAP_OWNER_PASSWORD shorter than 8 characters', () => {
    const { error } = validate({ BOOTSTRAP_OWNER_LOGIN: 'owner', BOOTSTRAP_OWNER_PASSWORD: 'short' });
    expect(error?.message).toContain('BOOTSTRAP_OWNER_PASSWORD');
  });

  it('accepts a complete bootstrap owner', () => {
    const { error } = validate({ BOOTSTRAP_OWNER_LOGIN: 'owner', BOOTSTRAP_OWNER_PASSWORD: 'long-enough-1' });
    expect(error).toBeUndefined();
  });

  // The vault key is optional, but a WRONG one must fail at boot rather than
  // quietly writing copies nobody can ever open again.
  it('accepts a 32-byte base64 PASSWORD_VAULT_KEY', () => {
    const { error } = validate({ PASSWORD_VAULT_KEY: Buffer.alloc(32, 7).toString('base64') });
    expect(error).toBeUndefined();
  });

  it('treats an empty PASSWORD_VAULT_KEY as unset — the vault is off by default', () => {
    const { error, value } = validate({ PASSWORD_VAULT_KEY: '' });
    expect(error).toBeUndefined();
    expect(value.PASSWORD_VAULT_KEY).toBeUndefined();
  });

  it('rejects a PASSWORD_VAULT_KEY that is not 32 bytes of base64', () => {
    expect(validate({ PASSWORD_VAULT_KEY: 'not base64!!' }).error?.message).toContain(
      'PASSWORD_VAULT_KEY',
    );
    expect(
      validate({ PASSWORD_VAULT_KEY: Buffer.alloc(16, 7).toString('base64') }).error?.message,
    ).toContain('PASSWORD_VAULT_KEY');
  });

  it('still requires APP_URL and a 32-character JWT_SECRET', () => {
    const { error } = envValidationSchema.validate({}, { allowUnknown: true, abortEarly: false });
    expect(error?.message).toContain('APP_URL');
    expect(error?.message).toContain('JWT_SECRET');
  });
});
