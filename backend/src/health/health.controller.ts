import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  HealthIndicatorService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { appConfig } from '../config/app.config';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly indicator: HealthIndicatorService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  // Liveness: the process is up — no dependency checks.
  @Get('live')
  @HealthCheck()
  live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  // Readiness: the app can serve traffic — DB and Redis are reachable.
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.pingRedis('redis'),
    ]);
  }

  // Which build is serving this hostname. Unauthenticated like live/ready:
  // a commit hash is not a secret, and CI needs it before it has a token.
  @Get('version')
  version(): { commit: string } {
    return { commit: this.app.commit };
  }

  private async pingRedis(key: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(key);
    try {
      await this.redis.ping();
      return check.up();
    } catch (err) {
      return check.down(err instanceof Error ? err.message : 'Redis ping failed');
    }
  }
}
