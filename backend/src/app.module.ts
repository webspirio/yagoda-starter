import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import * as Joi from 'joi';
import type { Redis } from 'ioredis';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RedisModule, REDIS_CLIENT } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { TimeModule } from './time/time.module';
import { UsersModule } from './users/users.module';
import { CollectionPointsModule } from './collection-points/collection-points.module';
import { ProductsModule } from './products/products.module';
import { TareTypesModule } from './tare-types/tare-types.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { ShiftsModule } from './shifts/shifts.module';
import { IntakesModule } from './intakes/intakes.module';
import { SupplierBalanceModule } from './supplier-balance/supplier-balance.module';
import { PayoutsModule } from './payouts/payouts.module';
import { TransfersModule } from './transfers/transfers.module';
import { PointCashModule } from './point-cash/point-cash.module';
import { CashCountsModule } from './cash-counts/cash-counts.module';
import { GradePricesModule } from './grade-prices/grade-prices.module';
import { AuditModule } from './audit/audit.module';
import { MediaModule } from './media/media.module';
import { AuthModule } from './auth/auth.module';
import { CurrentUserModule } from './current-user/current-user.module';
import { UserAdminModule } from './user-admin/user-admin.module';
import { appConfig } from './config/app.config';
import { databaseConfig } from './config/database.config';
import { authConfig } from './config/auth.config';
import { redisConfig } from './config/redis.config';
import { timezoneConfig } from './config/timezone.config';
import { uploadsConfig } from './config/uploads.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, authConfig, redisConfig, timezoneConfig, uploadsConfig],
      validationSchema: Joi.object({
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
        BOOTSTRAP_OWNER_LOGIN: Joi.string().optional(),
        BOOTSTRAP_OWNER_PASSWORD: Joi.string().min(8).optional(),
        BOOTSTRAP_OWNER_FIRST_NAME: Joi.string().optional(),
        BOOTSTRAP_OWNER_LAST_NAME: Joi.string().optional(),
        UPLOADS_DIR: Joi.string().optional(),
      }),
    }),
    LoggerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (app: ConfigType<typeof appConfig>) => ({
        pinoHttp: {
          redact: ['req.headers.authorization'],
          genReqId: () => randomUUID(),
          autoLogging: {
            ignore: (req) => (req.url ?? '').startsWith('/health'),
          },
          transport: app.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
        },
      }),
    }),
    // Redis-backed storage: rate-limit counters are shared across replicas and
    // survive restarts (in-memory counters silently reset and multiply by
    // instance count the moment the backend scales past one).
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        throttlers: [
          {
            ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
            limit: Number(process.env.THROTTLE_LIMIT ?? 100),
          },
        ],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (db: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: db.host,
        port: db.port,
        username: db.username,
        password: db.password,
        database: db.name,
        // Managed Postgres (Neon/RDS/Supabase/…) requires TLS: set DB_SSL=true.
        ssl: db.ssl ? { rejectUnauthorized: false } : undefined,
        extra: { max: 20 },
        // Entities register through each feature module's forFeature() — a new
        // <feature>.entity.ts needs no central list. The CLI data source
        // (data-source.ts) discovers them via glob instead.
        autoLoadEntities: true,
        // Numeric-prefixed only, matching data-source.ts's CLI glob: this
        // repo's build excludes `**/*.db-spec.ts` from dist/ today, so an
        // unrestricted glob happens to be safe here — but that safety lives
        // in tsconfig.build.json, a file this glob doesn't reference. Stating
        // the restriction here too means a future build-config change can't
        // silently reintroduce the CLI's schema.db-spec.ts crash at runtime.
        migrations: [`${__dirname}/migrations/[0-9]*{.ts,.js}`],
        migrationsTableName: 'migrations',
        migrationsRun: true,
        synchronize: false,
      }),
    }),
    // In-process cron. Single-replica assumption — same as migrationsRun above:
    // with >1 replica every instance fires each tick, and only a DB-side
    // conditional UPDATE keeps such a job exactly-once (see guarded-tick.ts).
    ScheduleModule.forRoot(),
    RedisModule,
    HealthModule,
    TimeModule,
    UsersModule,
    CollectionPointsModule,
    ProductsModule,
    TareTypesModule,
    SuppliersModule,
    ShiftsModule,
    IntakesModule,
    SupplierBalanceModule,
    PayoutsModule,
    TransfersModule,
    PointCashModule,
    CashCountsModule,
    GradePricesModule,
    AuditModule,
    MediaModule,
    AuthModule,
    CurrentUserModule,
    UserAdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
