import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Payout } from '../payout.entity';
import { Shift } from '../../shifts/shift.entity';
import { ShiftsService } from '../../shifts/shifts.service';
import { assertCanSee } from '../../auth/access/document-access';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** One payout and its shift, if the caller may see it. Given a manager the caller is about to
 *  write, so the row is read `FOR UPDATE` — the state checked is the state written against. */
@Injectable()
export class LoadVisiblePayoutQuery {
  constructor(
    @InjectRepository(Payout) private readonly repo: Repository<Payout>,
    private readonly shifts: ShiftsService,
  ) {}

  async load(
    actor: AuthenticatedUser,
    id: string,
    manager?: EntityManager,
  ): Promise<{ payout: Payout; shift: Shift }> {
    const payout = manager
      ? await manager.findOne(Payout, { where: { id }, lock: { mode: 'pessimistic_write' } })
      : await this.repo.findOne({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');

    const shift = await this.shifts.findOneRaw(payout.shift_id, manager);
    if (!shift) throw new NotFoundException('Payout not found');

    assertCanSee(actor, shift, 'Payout not found');
    return { payout, shift };
  }
}
