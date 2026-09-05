import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { AuditModule } from '../audit/audit.module';
import { UserAdminService } from './user-admin.service';
import { UsersController } from './users.controller';

/**
 * The operations module over the `users` domain — it owns no data of its own
 * and writes users only through UsersService/CredentialsService, the seams
 * that module exposes. Mirrors how `current-user` owns `/me`.
 */
@Module({
  imports: [UsersModule, CollectionPointsModule, AuditModule],
  controllers: [UsersController],
  providers: [UserAdminService],
})
export class UserAdminModule {}
