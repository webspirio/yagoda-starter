import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CurrentUserService } from './current-user.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { MediaService, UploadedImage } from '../media/media.service';
import { MediaPurpose, MEDIA_MAX_BYTES } from '../media/media.constants';

@Controller('me')
@Auth()
export class MeController {
  constructor(
    private readonly currentUser: CurrentUserService,
    private readonly media: MediaService,
  ) {}

  @Get()
  getMe(@CurrentUser() actor: AuthenticatedUser) {
    return this.currentUser.getMe(actor);
  }

  @Patch()
  updateMe(@CurrentUser() actor: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.currentUser.updateMe(actor, dto);
  }

  /** `limits.fileSize` rejects an oversized upload with a 413 before the whole
   *  body is buffered — the cap is not something to check after the fact. */
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MEDIA_MAX_BYTES } }))
  async uploadAvatar(
    @CurrentUser() actor: AuthenticatedUser,
    @UploadedFile() file: UploadedImage,
  ) {
    const saved = await this.media.store(file, {
      purpose: MediaPurpose.Avatar,
      uploadedBy: actor.sub,
    });
    return this.currentUser.setAvatar(actor, saved.url);
  }
}
