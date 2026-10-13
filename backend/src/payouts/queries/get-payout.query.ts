import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoadVisiblePayoutQuery } from './load-visible-payout.query';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import { loadNameParts } from '../../users/display-names';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class GetPayoutQuery {
  constructor(
    private readonly visible: LoadVisiblePayoutQuery,
    private readonly dataSource: DataSource,
  ) {}

  async get(actor: AuthenticatedUser, id: string): Promise<PayoutResponse> {
    const { payout, shift } = await this.visible.load(actor, id);
    const names = await loadNameParts(this.dataSource.manager, [payout.paid_by_user_id]);
    return toPayoutResponse(payout, shift, names.get(payout.paid_by_user_id) ?? null);
  }
}
