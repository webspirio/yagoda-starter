import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';
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
import { CratesModule } from './crates/crates.module';
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
import { envValidationSchema } from './config/env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, authConfig, redisConfig, timezoneConfig, uploadsConfig],
      validationSchema: envValidationSchema,
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
    CratesModule,
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
