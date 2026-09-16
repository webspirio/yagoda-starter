import { registerAs } from '@nestjs/config';

// Joi validation in app.module.ts guarantees presence — '' is unreachable.
export const authConfig = registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET ?? '',
  // One long-lived access token, no refresh rotation (design §3). The value is
  // a `jsonwebtoken` expiry string, not seconds.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  // The AES-256 key (base64) behind `GET /users/:id/password`, unset by
  // default. It belongs here rather than in its own config because it is a
  // credential concern: `CredentialsService` is its only reader, and
  // `secret-box.ts` says what it buys and what it costs. Empty string means
  // no vault — no readable copy is written and none can be read back.
  passwordVaultKey: process.env.PASSWORD_VAULT_KEY ?? '',
}));
