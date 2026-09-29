import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Intake } from '../intake.entity';
import { Shift } from '../../shifts/shift.entity';
import { ShiftsService } from '../../shifts/shifts.service';
import { assertCanSee } from '../../auth/access/document-access';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** One receipt and its shift, if the caller may see it. With a manager the row is read
 *  `FOR UPDATE` inside the caller's transaction (the void path). The point comes from the shift (§2.3). */
@Injectable()
export class LoadVisibleIntakeQuery {
  constructor(
    @InjectRepository(Intake) private readonly repo: Repository<Intake>,
    private readonly shifts: ShiftsService,
  ) {}

  async load(
    actor: AuthenticatedUser,
    id: string,
    m?: EntityManager,
  ): Promise<{ intake: Intake; shift: Shift }> {
    const intake = m
      ? await m.findOne(Intake, { where: { id }, lock: { mode: 'pessimistic_write' } })
      : await this.repo.findOne({ where: { id } });
    if (!intake) throw new NotFoundException('Intake not found');

    // Two call shapes on purpose: the read path has always called `findOneRaw(id)` with one argument.
    const shift = m
      ? await this.shifts.findOneRaw(intake.shift_id, m)
      : await this.shifts.findOneRaw(intake.shift_id);
    if (!shift) throw new NotFoundException('Intake not found');

    assertCanSee(actor, shift, 'Intake not found');
    return { intake, shift };
  }
}
