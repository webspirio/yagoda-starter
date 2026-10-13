import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoadVisiblePayoutQuery } from './load-visible-payout.query';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import { User } from '../../users/user.entity';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class GetPayoutQuery {
  constructor(
    private readonly visible: LoadVisiblePayoutQuery,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async get(actor: AuthenticatedUser, id: string): Promise<PayoutResponse> {
    const { payout, shift } = await this.visible.load(actor, id);
    const paidBy = await this.users.findOne({ where: { id: payout.paid_by_user_id } });
    return toPayoutResponse(payout, shift, paidBy);
  }
}
