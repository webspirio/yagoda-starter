import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Intake } from '../intake.entity';
import { IntakeItem } from '../intake-item.entity';
import { IntakeDetailResponse, toIntakeDetailResponse } from '../intake.mapper';
import { ROW_EXTRAS_SQL, type IntakeRowExtras } from '../intake-row-extras';
import { Payout } from '../../payouts/payout.entity';
import { Shift } from '../../shifts/shift.entity';
import { User } from '../../users/user.entity';
import { displayNameOf } from '../../users/display-name';

/** The printed-receipt facts beyond the row itself: derived columns, lines, payouts, receiver. */
@Injectable()
export class IntakeDetailQuery {
  constructor(@InjectRepository(Intake) private readonly repo: Repository<Intake>) {}

  /** The derived columns for ONE document — read after any allocation in the same transaction,
   *  so `open_amount` and `paid_amount` see it. */
  async extras(intakeId: string, m: EntityManager): Promise<IntakeRowExtras> {
    const [row] = (await m.query(ROW_EXTRAS_SQL, [intakeId])) as IntakeRowExtras[];
    if (!row) throw new Error('intake row extras missing for ' + intakeId);
    return row;
  }

  /** `displayNameOf` — the ONE definition of a user's name. */
  async receiverName(userId: string, m: EntityManager): Promise<string | null> {
    const user = await m.findOne(User, { where: { id: userId } });
    return user ? displayNameOf(user) : null;
  }

  async forIntake(intake: Intake, shift: Shift): Promise<IntakeDetailResponse> {
    const m = this.repo.manager;
    const items = await m.find(IntakeItem, {
      where: { intake_id: intake.id },
      relations: { tare: true },
    });
    // Tiebreaker: two payouts in one millisecond are ordinary, and Postgres orders no ties.
    const payouts = await m.find(Payout, {
      where: { intake_id: intake.id },
      order: { created_at: 'ASC', id: 'ASC' },
    });
    return toIntakeDetailResponse(
      intake,
      shift,
      items,
      await this.extras(intake.id, m),
      payouts,
      await this.receiverName(intake.received_by_user_id, m),
    );
  }
}
