import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from './product.entity';
import { ProductGrade } from './product-grade.entity';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * Owns `products` AND `product_grades` — one aggregate. A grade is meaningless
 * without its product, and §4.1's visibility rule spans both tables, so it can
 * only be evaluated by something that can see both.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Product, ProductGrade]), AuditModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [TypeOrmModule, ProductsService],
})
export class ProductsModule {}
