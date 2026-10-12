import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkSettings } from '../network-settings.entity';
import { NetworkSettingsResponse, toNetworkSettingsResponse } from '../network-settings.mapper';

@Injectable()
export class GetNetworkSettingsQuery {
  constructor(
    @InjectRepository(NetworkSettings)
    private readonly repo: Repository<NetworkSettings>,
  ) {}

  /** The migration inserts the only row, so there is no "not created yet". */
  async get(): Promise<NetworkSettingsResponse> {
    return toNetworkSettingsResponse(await this.repo.findOneByOrFail({ id: true }));
  }
}
