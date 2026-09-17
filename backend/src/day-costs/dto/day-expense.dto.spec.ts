import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateDayExpenseDto } from './create-day-expense.dto';
import { UpdateDayExpenseDto } from './update-day-expense.dto';

/**
 * `day_expenses.amount` is `numeric(12,2)`, and this backend maps NO
 * `QueryFailedError` (`common/filters/all-exceptions.filter.ts`), so anything
 * that reaches Postgres as a constraint violation or an overflow comes back as
 * an opaque 500. The digit bound is what keeps an over-long amount a 400 — the
 * same bound and the same reason as `CreateIntakeTopUpDto`.
 *
 * `@CanonicalDecimal()` is the other half: `PATCH {"amount":"1000"}` against a
 * row already holding `1000.00` must be a NO-OP, not a phantom
 * `day-expense.updated` audit entry — and on the schema's one mutable money
 * table that audit trail is the whole compensating control.
 */
const create = (amount: unknown): CreateDayExpenseDto =>
  plainToInstance(CreateDayExpenseDto, { label: 'пальне', amount });
const createErrors = (amount: unknown): string[] =>
  validateSync(create(amount)).flatMap((e) => Object.keys(e.constraints ?? {}));

const update = (amount: unknown): UpdateDayExpenseDto =>
  plainToInstance(UpdateDayExpenseDto, { amount });
const updateErrors = (amount: unknown): string[] =>
  validateSync(update(amount)).flatMap((e) => Object.keys(e.constraints ?? {}));

describe('CreateDayExpenseDto.amount', () => {
  it('accepts a plain amount', () => {
    expect(createErrors('1000.00')).toEqual([]);
  });

  it('canonicalises to scale 2 so the echo matches the stored row', () => {
    expect(create('1000').amount).toBe('1000.00');
    expect(create('1.2').amount).toBe('1.20');
  });

  it('REFUSES an amount numeric(12,2) cannot hold — a 400, never an overflow 500', () => {
    expect(createErrors('99999999999999')).toContain('matches');
  });

  it.each(['abc', '1.234', '-5.00', ''])('refuses the malformed %j', (amount) => {
    expect(createErrors(amount)).toContain('matches');
  });
});

describe('UpdateDayExpenseDto.amount', () => {
  it('canonicalises, so a no-op PATCH writes no phantom audit entry', () => {
    expect(update('1000').amount).toBe('1000.00');
  });

  it('REFUSES an over-long amount', () => {
    expect(updateErrors('99999999999999')).toContain('matches');
  });

  it('leaves an absent amount absent', () => {
    expect(updateErrors(undefined)).toEqual([]);
    expect(update(undefined).amount).toBeUndefined();
  });
});
