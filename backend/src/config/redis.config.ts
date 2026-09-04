import { registerAs } from '@nestjs/config';

// Defaults mirror the Joi schema in app.module.ts.
export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
}));
