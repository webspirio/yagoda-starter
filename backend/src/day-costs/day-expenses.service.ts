import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DayExpense } from './day-expense.entity';
import { CreateDayExpenseDto } from './dto/create-day-expense.dto';
import { UpdateDayExpenseDto } from './dto/update-day-expense.dto';
import { ShiftsService } from '../shifts/shifts.service';
import { AuditService } from '../audit/audit.service';
import { diffFields } from '../common/diff-fields';
import { gt } from '../common/money';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const DAY_EXPENSE_FIELDS = ['label', 'amount'] as const;

/**
 * §8.3 — the day's expenses at the base or a point.
 *
 * THE ONE MUTABLE SERVICE IN THIS SLICE. Every neighbour (`intakes`,
 * `payouts`, `reweighs`, …) freezes its document and turns a correction into a
 * void plus a new row; this one has `update`/`remove` instead, and no
 * `void_*` trio — see `day-expense.entity.ts` and the migration's doc comment
 * for why. The cost of that choice is that a past day's собівартість can move
 * with no journal trace, which is exactly what every write here answers by
 * recording an audit entry with before/after.
 *
 * `create`/`update`/`remove` EACH RUN IN A TRANSACTION, row write and audit
 * entry together, with the entry written through THAT transaction's manager
 * — never a bare `undefined`. The audit entry is this table's compensating
 * control for being mutable at all; one that could commit independently of
 * the write it describes could also go missing independently of it (the row
 * write commits, the audit insert then fails), leaving exactly the untracked
 * drift the mutability argument assumes cannot happen.
 */
@Injectable()
export class DayExpensesService {
  constructor(
    @InjectRepository(DayExpense)
    private readonly repo: Repository<DayExpense>,
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    shiftId: string,
    dto: CreateDayExpenseDto,
  ): Promise<DayExpense> {
    const shift = await this.shifts.findOneRaw(shiftId);
    if (!shift) throw new NotFoundException('Shift not found');

    const label = this.assertLabel(dto.label);
    this.assertPositive(dto.amount);

    return this.dataSource.transaction(async (m) => {
      const saved = await m.save(DayExpense, {
        shift_id: shiftId,
        label,
        amount: dto.amount,
        created_by_user_id: actor.sub,
      });

      await this.audit.record(
        {
          action: 'day-expense.created',
          actor_id: actor.sub,
          target_type: 'day_expense',
          target_id: saved.id,
          after: { shift_id: saved.shift_id, label: saved.label, amount: saved.amount },
        },
        m,
      );

      return saved;
    });
  }

  async listForShift(shiftId: string): Promise<DayExpense[]> {
    return this.repo.find({ where: { shift_id: shiftId }, order: { created_at: 'ASC' } });
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateDayExpenseDto,
  ): Promise<DayExpense> {
    const expense = await this.repo.findOne({ where: { id } });
    if (!expense) throw new NotFoundException('Day expense not found');

    const before = this.snapshot(expense);

    if (dto.label != null) expense.label = this.assertLabel(dto.label);
    if (dto.amount != null) {
      this.assertPositive(dto.amount);
      expense.amount = dto.amount;
    }

    return this.dataSource.transaction(async (m) => {
      const saved = await m.save(DayExpense, expense);
      const diff = diffFields(before, this.snapshot(saved), DAY_EXPENSE_FIELDS);

      if (diff) {
        await this.audit.record(
          {
            action: 'day-expense.updated',
            actor_id: actor.sub,
            target_type: 'day_expense',
            target_id: saved.id,
            before: diff.before,
            after: diff.after,
          },
          m,
        );
      }

      return saved;
    });
  }

  async remove(actor: AuthenticatedUser, id: string): Promise<void> {
    const expense = await this.repo.findOne({ where: { id } });
    if (!expense) throw new NotFoundException('Day expense not found');

    await this.dataSource.transaction(async (m) => {
      await m.delete(DayExpense, id);

      await this.audit.record(
        {
          action: 'day-expense.deleted',
          actor_id: actor.sub,
          target_type: 'day_expense',
          target_id: expense.id,
          before: { shift_id: expense.shift_id, label: expense.label, amount: expense.amount },
        },
        m,
      );
    });
  }

  /** A blank trimmed label is `LABEL_EMPTY`, same shape `CHK_day_expenses_label` guards in the DB. */
  private assertLabel(label: string): string {
    const trimmed = label.trim();
    if (trimmed === '') {
      throw new BadRequestException({ message: 'label must not be empty', code: 'LABEL_EMPTY' });
    }
    return trimmed;
  }

  /**
   * `CHK_day_expenses_amount` is `amount > 0`. The CHECK is the real
   * guarantee; this pre-check only keeps the refusal a 400 with a `code`
   * instead of the opaque 500 a `QueryFailedError` becomes, since nothing in
   * this backend maps one. Same shape and same reasoning as
   * `IntakeTopUpsService`'s `TOP_UP_AMOUNT_NOT_POSITIVE`.
   *
   * `gt`, never `>`: `amount` is a decimal STRING and JS string comparison
   * would make '9.00' greater than '10.00' (foundation §5.1).
   */
  private assertPositive(amount: string): void {
    if (!gt(amount, '0')) {
      throw new BadRequestException({
        message: 'An expense must cost something',
        code: 'EXPENSE_AMOUNT_NOT_POSITIVE',
      });
    }
  }

  private snapshot(expense: DayExpense): Record<(typeof DAY_EXPENSE_FIELDS)[number], unknown> {
    return { label: expense.label, amount: expense.amount };
  }
}
