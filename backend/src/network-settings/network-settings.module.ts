import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NetworkSettings } from './network-settings.entity';
import { NetworkSettingsController } from './network-settings.controller';
import { GetNetworkSettingsQuery } from './queries/get-network-settings.query';
import { UpdateNetworkSettingsCommand } from './commands/update-network-settings.command';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([NetworkSettings]), AuditModule],
  controllers: [NetworkSettingsController],
  providers: [GetNetworkSettingsQuery, UpdateNetworkSettingsCommand],
})
export class NetworkSettingsModule {}
