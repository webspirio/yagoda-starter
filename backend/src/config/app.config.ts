import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  // CORS allowlist: the frontend origin, plus the Vite dev servers outside
  // production. Joi validation in app.module.ts guarantees APP_URL is set,
  // so '' is unreachable.
  const corsOrigins = [new URL(process.env.APP_URL ?? '').origin];
  if (nodeEnv !== 'production') {
    corsOrigins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  }
  return {
    nodeEnv,
    port: parseInt(process.env.PORT ?? '3000', 10),
    // How many proxy hops sit in front of the app (see docker-compose.prod.yml).
    // 0 = trust nothing: req.ip is the socket peer, X-Forwarded-For is ignored.
    trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10),
    corsOrigins,
    // Full git SHA the image was built from — backend/Dockerfile bakes the
    // APP_COMMIT build-arg into the prod stage. CI compares this with the
    // commit it deployed (GET /health/version) before it calls a deploy done.
    commit: process.env.APP_COMMIT ?? 'unknown',
  };
});
