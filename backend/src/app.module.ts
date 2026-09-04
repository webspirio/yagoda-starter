import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import * as Joi from 'joi';
import type { Redis } from 'ioredis';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RedisModule, REDIS_CLIENT } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { TimeModule } from './time/time.module';
import { UsersModule } from './users/users.module';
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
        APP_TIMEZONE: Joi.string().default('UTC'),
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
        throttlers: [{ ttl: 60_000, limit: 100 }],
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
        migrations: [`${__dirname}/migrations/*{.ts,.js}`],
        migrationsTableName: 'migrations',
        migrationsRun: true,
        synchronize: false,
      }),
    }),
    // In-process cron. Single-replica assumption — same as migrationsRun above:
    // with >1 replica every instance fires each tick, and only a DB-side
    // conditional UPDATE keeps such a job exactly-once (see guarded-tick.ts).
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    RedisModule,
    HealthModule,
    TimeModule,
    UsersModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
