import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './supplier.entity';
import { SuppliersService } from './suppliers.service';
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
 * `SuppliersService` is exported for the module that will need it: `intakes`
 * must validate a `supplier_id` through its owner rather than growing its own
 * query. It has no `findOneRaw` yet — the three catalog services grew theirs
 * when the first caller appeared, and this one should too.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Supplier]), AuditModule, CollectionPointsModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [TypeOrmModule, SuppliersService],
})
export class SuppliersModule {}
