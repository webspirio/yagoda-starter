import { registerAs } from '@nestjs/config';

// Defaults mirror the Joi schema in app.module.ts. The IANA-validity check
// lives in TimeService so an unknown zone fails fast at boot.
export const timezoneConfig = registerAs('timezone', () => ({
  appTimezone: process.env.APP_TIMEZONE ?? 'Europe/Berlin',
}));
