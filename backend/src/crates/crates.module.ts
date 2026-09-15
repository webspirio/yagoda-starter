import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrateIssuance } from './crate-issuance.entity';
import { CrateReturn } from './crate-return.entity';
import { CrateReturnAllocation } from './crate-return-allocation.entity';
import { CratesService } from './crates.service';
import { CrateIssuancesController } from './crate-issuances.controller';
import { ShiftsModule } from '../shifts/shifts.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { TareTypesModule } from '../tare-types/tare-types.module';
import { AuditModule } from '../audit/audit.module';

/**
 * ONE MODULE, THREE TABLES. No separate `crate-balance` module: `supplier-
 * balance` and `point-cash` are their own modules because their queries span
 * tables owned by others, and this one reads only crate tables.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CrateIssuance, CrateReturn, CrateReturnAllocation]),
    ShiftsModule,
    SuppliersModule,
    CollectionPointsModule,
    TareTypesModule,
    AuditModule,
  ],
  providers: [CratesService],
  controllers: [CrateIssuancesController],
  exports: [CratesService],
})
export class CratesModule {}
