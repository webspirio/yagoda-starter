import { Injectable } from '@nestjs/common';
import { LoadVisiblePayoutQuery } from './load-visible-payout.query';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class GetPayoutQuery {
  constructor(private readonly visible: LoadVisiblePayoutQuery) {}

  async get(actor: AuthenticatedUser, id: string): Promise<PayoutResponse> {
    const { payout, shift } = await this.visible.load(actor, id);
    return toPayoutResponse(payout, shift);
  }
}
