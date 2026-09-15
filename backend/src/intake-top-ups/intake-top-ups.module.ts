import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntakeTopUp } from './intake-top-up.entity';
import { IntakeTopUpsService } from './intake-top-ups.service';
import { IntakeTopUpsController } from './intake-top-ups.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * IMPORTS NEITHER `ShiftsModule` NOR `SuppliersModule`, and both absences are
 * deliberate. There is no shift rule to apply (see the service header), and
 * the supplier is reached by JOIN rather than by service call because the
 * scope question here is "which rows", not "may this actor see this supplier".
 *
 * That keeps this module a leaf: it imports only `AuditModule`, so no cycle is
 * possible through it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IntakeTopUp]), AuditModule],
  providers: [IntakeTopUpsService],
  controllers: [IntakeTopUpsController],
  exports: [IntakeTopUpsService],
})
export class IntakeTopUpsModule {}
