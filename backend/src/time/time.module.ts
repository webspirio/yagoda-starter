import { Global, Module } from '@nestjs/common';
import { TimeService } from './time.service';

/**
 * Global module so any feature can inject `TimeService` without re-importing —
 * the same pattern as `RedisModule`. `timezoneConfig` is loaded globally by
 * `ConfigModule` in `app.module.ts`, so the service's config dependency resolves
 * without a local `forFeature`.
 */
@Global()
@Module({
  providers: [TimeService],
  exports: [TimeService],
})
export class TimeModule {}
