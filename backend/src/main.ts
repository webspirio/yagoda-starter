import 'reflect-metadata';
import { mkdirSync } from 'fs';
import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { appConfig } from './config/app.config';
import { uploadsConfig } from './config/uploads.config';
import { installUnhandledRejectionHandler } from './common/process-safety';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  // Earliest point a pino logger exists. Anything that rejects before this —
  // i.e. inside NestFactory.create — is a boot failure and should crash.
  installUnhandledRejectionHandler(logger);

  app.enableShutdownHooks();

  const cfg = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);

  // Trust exactly the number of proxy hops in front of the app (prod: host TLS
  // proxy + nginx = 2, set via TRUST_PROXY_HOPS) so rate limiting and logs key
  // on the real client IP. Trusting more hops than actually exist lets clients
  // spoof X-Forwarded-For and bypass per-IP throttling; the default (0, e.g. in
  // dev) trusts nothing and uses the socket peer address.
  if (cfg.trustProxyHops > 0) {
    app.set('trust proxy', cfg.trustProxyHops);
  }
  app.use(helmet());

  app.enableCors({ origin: cfg.corsOrigins });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // Response-serialization boundary: entity fields marked @Exclude() (e.g.
  // UserIdentity.provider_data) never leave the API, no matter which
  // controller returns them. Mark sensitive fields at the entity, not by
  // hand-picking fields in every handler.
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // Uploaded files (avatars) are served as static assets. Location and public
  // prefix come from one place (uploads.config.ts); the upload endpoint writes
  // into the same directory.
  const uploads = app.get<ConfigType<typeof uploadsConfig>>(uploadsConfig.KEY);
  mkdirSync(uploads.dir, { recursive: true });
  app.useStaticAssets(uploads.dir, {
    prefix: `${uploads.publicPrefix}/`,
    // These are public images (avatars) embedded via <img>, whose origin
    // differs from the API's (in dev the Vite dev-server origin; in prod a
    // distinct port/host). Helmet's
    // default Cross-Origin-Resource-Policy is `same-origin`, which makes the
    // browser block a cross-origin <img> load — the image 200s but renders as a
    // broken icon. Relax it to `cross-origin` for these static assets only; the
    // JSON API keeps helmet's stricter default (it's fetched via CORS, which
    // CORP doesn't govern).
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  await app.listen(cfg.port);
  logger.log(`Backend running on http://localhost:${cfg.port}`);
}

// A boot failure must still be fatal. installUnhandledRejectionHandler() above
// deliberately keeps the process alive for a stray rejection at runtime, which
// would otherwise swallow a failed listen() or a throwing provider and leave a
// zombie: schedule timers already mounted by init(), nothing serving. Compose's
// restart policy triggers on exit, not on an unhealthy healthcheck.
bootstrap().catch((err) => {
  console.error('bootstrap failed', err);
  process.exit(1);
});
