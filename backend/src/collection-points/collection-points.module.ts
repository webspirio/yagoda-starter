import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionPoint } from './collection-point.entity';
import { CollectionPointsService } from './collection-points.service';
import { CollectionPointsController } from './collection-points.controller';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([CollectionPoint]), UsersModule, AuditModule],
  controllers: [CollectionPointsController],
  providers: [CollectionPointsService],
  exports: [TypeOrmModule, CollectionPointsService],
})
export class CollectionPointsModule {}
