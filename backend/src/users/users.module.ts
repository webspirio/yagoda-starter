import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UserIdentity } from './user-identity.entity';
import { UserCredentials } from './user-credentials.entity';
import { UsersService } from './users.service';
import { CredentialsService } from './credentials.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserIdentity, UserCredentials])],
  providers: [UsersService, CredentialsService],
  exports: [UsersService, CredentialsService],
})
export class UsersModule {}
