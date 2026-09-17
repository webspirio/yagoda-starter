import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reweigh } from './reweigh.entity';
import { ReweighItem } from './reweigh-item.entity';
import { ReweighItemTareType } from './reweigh-item-tare-type.entity';
import { ReweighsService } from './reweighs.service';
import { ReweighsController } from './reweighs.controller';
import { ShiftsModule } from '../shifts/shifts.module';
import { TareTypesModule } from '../tare-types/tare-types.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reweigh, ReweighItem, ReweighItemTareType]),
    ShiftsModule,
    TareTypesModule,
    AuditModule,
  ],
  providers: [ReweighsService],
  controllers: [ReweighsController],
  exports: [ReweighsService],
})
export class ReweighsModule {}
