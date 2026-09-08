import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shift } from './shift.entity';
import { ShiftsService } from './shifts.service';
import { ShiftsController } from './shifts.controller';
import { AuditModule } from '../audit/audit.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';

/**
 * Exports `ShiftsService` because both document modules resolve their shift
 * through it rather than reaching for the repository — `shifts` stays the sole
 * writer of its own table, and `findOpenAtPoint` accepts an `EntityManager` so
 * a document write reads it inside its own transaction.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Shift]), AuditModule, CollectionPointsModule],
  providers: [ShiftsService],
  controllers: [ShiftsController],
  exports: [ShiftsService],
})
export class ShiftsModule {}
