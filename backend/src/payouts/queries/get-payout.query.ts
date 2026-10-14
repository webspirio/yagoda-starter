import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoadVisiblePayoutQuery } from './load-visible-payout.query';
import { PayoutDetailResponse, toPayoutDetailResponse } from '../payout.mapper';
import { CollectionPoint } from '../../collection-points/collection-point.entity';
import { User } from '../../users/user.entity';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class GetPayoutQuery {
  constructor(
    private readonly visible: LoadVisiblePayoutQuery,
    private readonly dataSource: DataSource,
  ) {}

  /** The payout and the two numbers its receipt header prints — the payer's, not the viewer's,
   *  and the point's, so the receipt never waits on the client's point list. */
  async get(actor: AuthenticatedUser, id: string): Promise<PayoutDetailResponse> {
    const { payout, shift } = await this.visible.load(actor, id);
    const m = this.dataSource.manager;
    const payer = await m.findOne(User, {
      where: { id: payout.paid_by_user_id },
      select: { id: true, number: true },
    });
    const point = await m.findOneOrFail(CollectionPoint, {
      where: { id: shift.collection_point_id },
      select: { id: true, number: true },
    });
    return toPayoutDetailResponse(payout, shift, payer?.number ?? null, point.number);
  }
}
