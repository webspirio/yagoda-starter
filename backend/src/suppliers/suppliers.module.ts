import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './supplier.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * Its own module. `suppliers` shares nothing with the catalogs: it is scoped
 * to a point, written by operators, and its whole reason to exist is to be one
 * half of `Σ intakes − Σ payouts`.
 *
 * `SuppliersService` is exported so `intakes` can validate a `supplier_id`
 * through its owner rather than growing its own query.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Supplier]), AuditModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [TypeOrmModule, SuppliersService],
})
export class SuppliersModule {}
