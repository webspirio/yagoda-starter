import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './supplier.entity';
import { ListSuppliersQuery } from './queries/list-suppliers.query';
import { FindSupplierQuery } from './queries/find-supplier.query';
import { CreateSupplierCommand } from './commands/create-supplier.command';
import { UpdateSupplierCommand } from './commands/update-supplier.command';
import { SuppliersController } from './suppliers.controller';
import { AuditModule } from '../audit/audit.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';

/**
 * Its own module. `suppliers` shares nothing with the catalogs: it is scoped
 * to a point, written by operators, and its whole reason to exist is to be one
 * half of `Σ intakes − Σ payouts`.
 *
 * Depends on `CollectionPointsModule` for READS ONLY — validating that an
 * owner-supplied `collection_point_id` exists. Same one-way shape as
 * `GradePricesModule`; no cycle, since `CollectionPointsModule` imports only
 * `UsersModule` and `AuditModule`.
 *
 * `FindSupplierQuery` is exported: every module that takes a `supplier_id`
 * validates it through its owner rather than growing its own query.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Supplier]), AuditModule, CollectionPointsModule],
  controllers: [SuppliersController],
  providers: [ListSuppliersQuery, FindSupplierQuery, CreateSupplierCommand, UpdateSupplierCommand],
  exports: [TypeOrmModule, FindSupplierQuery],
})
export class SuppliersModule {}
