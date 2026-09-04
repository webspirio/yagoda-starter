import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import { redisConfig } from '../config/redis.config';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [redisConfig.KEY],
      useFactory: (redisCfg: ConfigType<typeof redisConfig>) => {
        const logger = new Logger('Redis');
        const client = new Redis({
          host: redisCfg.host,
          port: redisCfg.port,
          // Reconnect forever with capped exponential backoff — a briefly
          // unavailable Redis must not kill the app.
          retryStrategy: (times) => Math.min(times * 200, 2000),
          // Reject queued commands after a couple of reconnect attempts instead
          // of buffering forever, so callers (throttler, /health/ready) see an
          // error quickly rather than hanging while Redis is down.
          maxRetriesPerRequest: 2,
          lazyConnect: false,
        });
        client.on('error', (err) => logger.error('Redis connection error', err));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
