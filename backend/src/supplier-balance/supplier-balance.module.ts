import { Module } from '@nestjs/common';
import { SupplierBalanceService } from './supplier-balance.service';
import { SupplierBalanceController } from './supplier-balance.controller';
import { SuppliersModule } from '../suppliers/suppliers.module';

/**
 * OWNS NO TABLE AND WRITES NOTHING. It exists so the debt formula — which spans
 * `intakes` and `payouts` and must carry `voided_at IS NULL` on BOTH halves —
 * has exactly one home. Routing it through the two document services would
 * either return two numbers to subtract in a third place or drag a `SUM` into
 * services that own a row model.
 *
 * This is the `nest-module-conventions` invariant it satisfies: READS ARE OPEN,
 * writes go through a seam. It reads two other modules' tables directly and
 * mutates nothing.
 *
 * `PayoutsModule` imports it for the §3.6 ceiling; nothing else does.
 */
@Module({
  imports: [SuppliersModule],
  providers: [SupplierBalanceService],
  controllers: [SupplierBalanceController],
  exports: [SupplierBalanceService],
})
export class SupplierBalanceModule {}
