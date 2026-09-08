import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GradePrice } from './grade-price.entity';
import { GradePricesService } from './grade-prices.service';
import { GradePricesController } from './grade-prices.controller';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { ProductsModule } from '../products/products.module';

/**
 * Depends on `ProductsModule` and `CollectionPointsModule` for READS ONLY —
 * validating that a grade exists and is active, and that a point exists. The
 * dependency points one way and each module stays the sole WRITER of its own
 * tables.
 *
 * No `AuditModule`: this table is its own history. See
 * `GradePricesService`'s doc comment for the full argument.
 */
@Module({
  imports: [TypeOrmModule.forFeature([GradePrice]), CollectionPointsModule, ProductsModule],
  controllers: [GradePricesController],
  providers: [GradePricesService],
  exports: [TypeOrmModule, GradePricesService],
})
export class GradePricesModule {}
