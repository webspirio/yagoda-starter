import { Module } from '@nestjs/common';
import { SupplierBalanceService } from './supplier-balance.service';
import { SupplierBalanceController } from './supplier-balance.controller';
import { SupplierBalancesController } from './supplier-balances.controller';
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
 *
 * TWO CONTROLLERS, ONE FORMULA: `GET /suppliers/:id/balance` answers for one
 * person, `GET /supplier-balances` for every supplier at a point (the
 * «Залишки» screen). Both read `SupplierBalanceService`, where the SQL exists
 * exactly once and the list is the same expression correlated per row.
 */
@Module({
  imports: [SuppliersModule],
  providers: [SupplierBalanceService],
  controllers: [SupplierBalanceController, SupplierBalancesController],
  exports: [SupplierBalanceService],
})
export class SupplierBalanceModule {}
