import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionPoint } from './collection-point.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CollectionPoint])],
  exports: [TypeOrmModule],
})
export class CollectionPointsModule {}
