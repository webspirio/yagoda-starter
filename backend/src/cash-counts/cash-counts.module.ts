import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashCount } from './cash-count.entity';
import { CashCountsService } from './cash-counts.service';
import { CashCountsController } from './cash-counts.controller';

/**
 * READ ONLY (see `CashCountsService`'s header) — this module registers
 * `CashCount` for TypeORM's benefit (the entity needs a home for migrations
 * and `autoLoadEntities` even though this module's own queries are raw SQL
 * through `DataSource`, joined against `shifts`), never a repository this
 * module writes through. `shifts` is still the sole writer of the table.
 *
 * EXPORTS NOTHING — nothing outside this module has a reason to read a count
 * except through this list.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CashCount])],
  providers: [CashCountsService],
  controllers: [CashCountsController],
})
export class CashCountsModule {}
