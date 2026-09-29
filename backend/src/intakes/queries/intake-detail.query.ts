import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Intake } from '../intake.entity';
import { IntakeItem } from '../intake-item.entity';
import {
  IntakeCrateReturnRow,
  IntakeDetailResponse,
  toIntakeDetailResponse,
} from '../intake.mapper';
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

  /** The lines WITH their product and grade names — `create` and `forIntake` both read them
   *  here. `create` cannot reuse the cascade-saved `intake.items`: those never load
   *  `product_grade`, so the mapper's `?? ''` would answer both names empty on every line of a
   *  freshly created receipt. */
  async items(intakeId: string, m: EntityManager): Promise<IntakeItem[]> {
    return m.find(IntakeItem, {
      where: { intake_id: intakeId },
      relations: { tare: true, product_grade: { product: true } },
    });
  }

  /** `displayNameOf` — the ONE definition of a user's name. */
  async receiverName(userId: string, m: EntityManager): Promise<string | null> {
    const user = await m.findOne(User, { where: { id: userId } });
    return user ? displayNameOf(user) : null;
  }

  /**
   * The crate return written WITH this receipt (spec §8.3), voided or not — `create` and
   * `forIntake` both read it here, so the receipt printed at the counter and the one reopened
   * later are the same query. `UQ_crate_returns_intake` makes it at most one row. The split by
   * MODE is summed from the FIFO allocation rows joined to the issuance each drew from, cast
   * `::int` so the driver hands back numbers.
   */
  async crateReturn(intakeId: string, m: EntityManager): Promise<IntakeCrateReturnRow | null> {
    const [row] = (await m.query(
      `SELECT cr.id,
              cr.units,
              cr.deposit_refund,
              cr.voided_at,
              COALESCE(SUM(a.units) FILTER (WHERE ci.mode = 'deposit'), 0)::int AS deposit_units,
              COALESCE(SUM(a.units) FILTER (WHERE ci.mode = 'receipt'), 0)::int AS receipt_units
         FROM crate_returns cr
         LEFT JOIN crate_return_allocations a ON a.return_id = cr.id
         LEFT JOIN crate_issuances ci ON ci.id = a.issuance_id
        WHERE cr.intake_id = $1
        GROUP BY cr.id`,
      [intakeId],
    )) as IntakeCrateReturnRow[];
    return row ?? null;
  }

  async forIntake(intake: Intake, shift: Shift): Promise<IntakeDetailResponse> {
    const m = this.repo.manager;
    const items = await this.items(intake.id, m);
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
      await this.crateReturn(intake.id, m),
    );
  }
}
