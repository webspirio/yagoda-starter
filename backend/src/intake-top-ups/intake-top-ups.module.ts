import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntakeTopUp } from './intake-top-up.entity';
import { CreateIntakeTopUpCommand } from './commands/create-intake-top-up.command';
import { VoidIntakeTopUpCommand } from './commands/void-intake-top-up.command';
import { GetIntakeTopUpQuery } from './queries/get-intake-top-up.query';
import { ListIntakeTopUpsQuery } from './queries/list-intake-top-ups.query';
import { IntakeTopUpsController } from './intake-top-ups.controller';
import { AuditModule } from '../audit/audit.module';
import { SupplierBalanceModule } from '../supplier-balance/supplier-balance.module';

/**
 * Owner-written debt on a receipt (#61). No `ShiftsModule` (no shift rule applies) and no
 * `SuppliersModule` (the supplier is reached by JOIN — a "which rows" question, not "may this
 * actor see this supplier"). Allocations go through the supplier ledger. Exports nothing.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IntakeTopUp]), AuditModule, SupplierBalanceModule],
  providers: [
    CreateIntakeTopUpCommand,
    VoidIntakeTopUpCommand,
    GetIntakeTopUpQuery,
    ListIntakeTopUpsQuery,
  ],
  controllers: [IntakeTopUpsController],
})
export class IntakeTopUpsModule {}
