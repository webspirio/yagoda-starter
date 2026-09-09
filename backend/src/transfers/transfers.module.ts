import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transfer } from './transfer.entity';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { AuditModule } from '../audit/audit.module';
import { TimeModule } from '../time/time.module';

/**
 * NO `ShiftsModule` IMPORT, deliberately — spec §6.4. A transfer is
 * point-scoped and its acceptance needs no open shift.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Transfer]), CollectionPointsModule, AuditModule, TimeModule],
  providers: [TransfersService],
  controllers: [TransfersController],
  exports: [TransfersService],
})
export class TransfersModule {}
