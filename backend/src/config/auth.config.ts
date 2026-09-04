import { registerAs } from '@nestjs/config';

// Joi validation in app.module.ts guarantees presence — '' is unreachable.
export const authConfig = registerAs('auth', () => ({
  jwtSecret: process.env.JWT_SECRET ?? '',
  // One long-lived access token, no refresh rotation (design §3). The value is
  // a `jsonwebtoken` expiry string, not seconds.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
}));
