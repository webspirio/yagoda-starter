import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TareType } from './tare-type.entity';
import { TareTypesService } from './tare-types.service';
import { TareTypesController } from './tare-types.controller';
import { AuditModule } from '../audit/audit.module';

/**
 * Its own module, not folded into `ProductsModule`: tare types share no
 * relationship with products. Their only links in the schema are to
 * `intake_item_tare_types` and the `is_crate` flag, neither of which touches a
 * product or a grade.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TareType]), AuditModule],
  controllers: [TareTypesController],
  providers: [TareTypesService],
  exports: [TypeOrmModule, TareTypesService],
})
export class TareTypesModule {}
