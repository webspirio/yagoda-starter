import { registerAs } from '@nestjs/config';

// Default is Europe/Kyiv, matching the Joi schema's default in app.module.ts
// — keep the two in step; a mismatch here is invisible in practice
// (ConfigModule backfills process.env.APP_TIMEZONE from the Joi default
// before this factory ever runs) but misleading to read. The IANA-validity
// check lives in TimeService so an unknown zone fails fast at boot.
export const timezoneConfig = registerAs('timezone', () => ({
  appTimezone: process.env.APP_TIMEZONE ?? 'Europe/Kyiv',
}));
