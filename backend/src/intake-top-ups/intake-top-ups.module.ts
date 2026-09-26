import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntakeTopUp } from './intake-top-up.entity';
import { IntakeTopUpsService } from './intake-top-ups.service';
import { IntakeTopUpsController } from './intake-top-ups.controller';
import { AuditModule } from '../audit/audit.module';
import { SupplierBalanceModule } from '../supplier-balance/supplier-balance.module';

/**
 * IMPORTS NEITHER `ShiftsModule` NOR `SuppliersModule`, and both absences are
 * deliberate. There is no shift rule to apply (see the service header), and
 * the supplier is reached by JOIN rather than by service call because the
 * scope question here is "which rows", not "may this actor see this supplier".
 *
 * Beyond `AuditModule` it imports only `SupplierBalanceModule` (the allocation
 * writer), which never imports this module back.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IntakeTopUp]), AuditModule, SupplierBalanceModule],
  providers: [IntakeTopUpsService],
  controllers: [IntakeTopUpsController],
  exports: [IntakeTopUpsService],
})
export class IntakeTopUpsModule {}
