import * as Joi from 'joi';

/**
 * The process-environment contract, validated once at boot by ConfigModule
 * (allowUnknown: true, abortEarly: false are ConfigModule's defaults).
 *
 * BOOTSTRAP_OWNER_*: `.empty('')` maps an empty string to `undefined`.
 * docker-compose.prod.yml forwards these as `${VAR:-}` so the BootstrapOwner
 * migration can read them inside the container; when the operator has not set
 * them that expands to "", which a plain `Joi.string().optional()` rejects —
 * and a fresh production stack crash-loops before its first request. "" and
 * "unset" have to mean the same thing, which is also what the migration
 * assumes (`if (!login || !password) return`).
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().integer().default(3000),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(0),
  // Public origin of the frontend. Drives the CORS allowlist in app.config.
  APP_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().integer().default(5432),
  DB_USER: Joi.string().default('app'),
  DB_PASSWORD: Joi.string().default('app'),
  DB_NAME: Joi.string().default('app'),
  DB_SSL: Joi.boolean().default(false),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().integer().default(6379),
  APP_TIMEZONE: Joi.string().default('Europe/Kyiv'),
  // Global per-IP rate limit. Configurable ONLY so the DB-backed HTTP
  // suites can raise it: every request in those specs comes from
  // 127.0.0.1, so one test run looks like a single abusive client and
  // trips the production default partway through. See
  // `src/testing/db-harness.ts`.
  THROTTLE_TTL_MS: Joi.number().integer().min(1).default(60_000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
  // Read ONLY by the BootstrapOwner migration, and only when the users
  // table is empty. Unset in development, where SeedDevAdmin covers it.
  BOOTSTRAP_OWNER_LOGIN: Joi.string().empty('').optional(),
  BOOTSTRAP_OWNER_PASSWORD: Joi.string().empty('').min(8).optional(),
  BOOTSTRAP_OWNER_FIRST_NAME: Joi.string().empty('').optional(),
  BOOTSTRAP_OWNER_LAST_NAME: Joi.string().empty('').optional(),
  // Makes an issued password readable back to the network owner (issue #11).
  // 32 random bytes in base64 — `openssl rand -base64 32`.
  //
  // THE RULE IS ON THE DECODED BYTES, NOT THE CHARACTERS, and that is not
  // pedantry: 33 bytes also encodes to 44 base64 characters, so a
  // character-count rule waves through a key `createCipheriv` cannot use.
  // Boot would then succeed, nothing would ever be sealed, and every row would
  // read «перевидайте пароль» forever — with reissuing no help. Unset (or '',
  // the ${VAR:-} case described above) means the vault is off: passwords are
  // hashed and nothing more.
  PASSWORD_VAULT_KEY: Joi.string()
    .empty('')
    .base64()
    .custom((value: string, helpers) =>
      Buffer.from(value, 'base64').length === 32 ? value : helpers.error('any.invalid'),
    )
    .optional()
    .messages({ 'any.invalid': 'PASSWORD_VAULT_KEY must decode to exactly 32 bytes' }),
  UPLOADS_DIR: Joi.string().optional(),
  // Baked into the image by backend/Dockerfile (ARG APP_COMMIT); read by
  // GET /health/version. Absent in dev, hence optional.
  APP_COMMIT: Joi.string().optional(),
});
