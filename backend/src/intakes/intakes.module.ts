import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Intake } from './intake.entity';
import { IntakeItem } from './intake-item.entity';
import { IntakeItemTareType } from './intake-item-tare-type.entity';
import { IntakesController } from './intakes.controller';
import { CreateIntakeCommand } from './commands/create-intake.command';
import { VoidIntakeCommand } from './commands/void-intake.command';
import { PriceIntakeQuery } from './queries/price-intake.query';
import { PreviewIntakeQuery } from './queries/preview-intake.query';
import { LoadVisibleIntakeQuery } from './queries/load-visible-intake.query';
import { IntakeDetailQuery } from './queries/intake-detail.query';
import { GetIntakeQuery } from './queries/get-intake.query';
import { ListIntakesQuery } from './queries/list-intakes.query';
import { ShiftsModule } from '../shifts/shifts.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { GradePricesModule } from '../grade-prices/grade-prices.module';
import { TareTypesModule } from '../tare-types/tare-types.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { AuditModule } from '../audit/audit.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { SupplierBalanceModule } from '../supplier-balance/supplier-balance.module';
import { CratesModule } from '../crates/crates.module';

/**
 * The berry receipt. Reads other modules through their services (grade prices and tare for
 * §2.8/§2.5 snapshots, shifts for the point and business date its tables do not store).
 * Writes payouts only through `PayoutWriter`, allocations only through the supplier ledger,
 * and the crates a supplier brings back with a receipt only through `CratesService`
 * (`writeReturn`, `voidReturnForIntake` — spec §8.3). Exports nothing — no other module
 * writes or reads receipts through it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Intake, IntakeItem, IntakeItemTareType]),
    ShiftsModule,
    SuppliersModule,
    GradePricesModule,
    TareTypesModule,
    CollectionPointsModule,
    AuditModule,
    PayoutsModule,
    CratesModule,
    SupplierBalanceModule,
  ],
  providers: [
    CreateIntakeCommand,
    VoidIntakeCommand,
    PriceIntakeQuery,
    PreviewIntakeQuery,
    LoadVisibleIntakeQuery,
    IntakeDetailQuery,
    GetIntakeQuery,
    ListIntakesQuery,
  ],
  controllers: [IntakesController],
})
export class IntakesModule {}
