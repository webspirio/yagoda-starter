import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';
import { MediaModule } from '../media/media.module';
import { CurrentUserService } from './current-user.service';
import { MeController } from './me.controller';

@Module({
  imports: [UsersModule, AuditModule, MediaModule],
  controllers: [MeController],
  providers: [CurrentUserService],
  exports: [CurrentUserService],
})
export class CurrentUserModule {}
