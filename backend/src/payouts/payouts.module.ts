import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payout } from './payout.entity';
import { PayoutsController } from './payouts.controller';
import { PayoutWriter } from './services/payout-writer';
import { CreatePayoutCommand } from './commands/create-payout.command';
import { VoidPayoutCommand } from './commands/void-payout.command';
import { SettleReturnCommand } from './commands/settle-return.command';
import { LoadVisiblePayoutQuery } from './queries/load-visible-payout.query';
import { GetPayoutQuery } from './queries/get-payout.query';
import { ListPayoutsQuery } from './queries/list-payouts.query';
import { ShiftsModule } from '../shifts/shifts.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SupplierBalanceModule } from '../supplier-balance/supplier-balance.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { AuditModule } from '../audit/audit.module';
import { PointCashModule } from '../point-cash/point-cash.module';

/**
 * Cash over the counter. `PayoutWriter` is the one writer of `payouts` and the module's only
 * export — the intake commands write the payout handed over with a receipt through it. The
 * debt half of §3.6 comes from `supplier-balance`, the cash half from `point-cash`; neither
 * formula is re-derived here. Does not import `IntakesModule`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Payout]),
    ShiftsModule,
    SuppliersModule,
    SupplierBalanceModule,
    CollectionPointsModule,
    AuditModule,
    PointCashModule,
  ],
  providers: [
    PayoutWriter,
    CreatePayoutCommand,
    VoidPayoutCommand,
    SettleReturnCommand,
    LoadVisiblePayoutQuery,
    GetPayoutQuery,
    ListPayoutsQuery,
  ],
  controllers: [PayoutsController],
  exports: [PayoutWriter],
})
export class PayoutsModule {}
