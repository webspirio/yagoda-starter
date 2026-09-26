import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupplierBalanceService } from './supplier-balance.service';
import { SupplierBalanceController } from './supplier-balance.controller';
import { SupplierBalancesController } from './supplier-balances.controller';
import { AllocationsService } from './allocations.service';
import { PayoutAllocation } from './payout-allocation.entity';
import { SuppliersModule } from '../suppliers/suppliers.module';

/**
 * Owns `payout_allocations` and nothing else. The debt formula still reads
 * `intakes`, `intake_top_ups` and `payouts` directly (reads are open);
 * allocation rows are written only through `AllocationsService`.
 *
 * This is the `nest-module-conventions` invariant it satisfies: READS ARE OPEN,
 * writes go through a seam. It reads two other modules' tables directly and
 * mutates nothing beyond its own table.
 *
 * Imported by `PayoutsModule` (ceiling + allocations), `IntakesModule` and
 * `IntakeTopUpsModule` (allocations).
 *
 * TWO CONTROLLERS, ONE FORMULA: `GET /suppliers/:id/balance` answers for one
 * person, `GET /supplier-balances` for every supplier at a point (the
 * «Залишки» screen). Both read `SupplierBalanceService`, where the SQL exists
 * exactly once and the list is the same expression correlated per row.
 */
@Module({
  imports: [SuppliersModule, TypeOrmModule.forFeature([PayoutAllocation])],
  providers: [SupplierBalanceService, AllocationsService],
  controllers: [SupplierBalanceController, SupplierBalancesController],
  exports: [SupplierBalanceService, AllocationsService],
})
export class SupplierBalanceModule {}
