import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaFile } from './media-file.entity';
import { MediaService } from './media.service';

/** Shared image storage: local disk + `media_files` metadata. */
@Module({
  imports: [TypeOrmModule.forFeature([MediaFile])],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
