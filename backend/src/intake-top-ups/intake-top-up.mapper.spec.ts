import { IntakeTopUp } from './intake-top-up.entity';
import { toIntakeTopUpResponse } from './intake-top-up.mapper';

const row = (over: Partial<IntakeTopUp> = {}): IntakeTopUp =>
  ({
    id: 'top-up-1',
    intake_id: 'intake-1',
    amount: '2000.00',
    reason: 'перерахували ціну після здачі',
    created_by_user_id: 'owner-1',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: new Date('2026-09-11T08:00:00.000Z'),
    updated_at: new Date('2026-09-11T08:00:00.000Z'),
    ...over,
  }) as IntakeTopUp;

const parent = (voided_at: Date | null = null) => ({
  id: 'intake-1',
  code: 'KPG-IN-20260908-04412',
  voided_at,
});

describe('toIntakeTopUpResponse', () => {
  it('counts toward the balance when both the row and its parent are live', () => {
    const res = toIntakeTopUpResponse(row(), parent());

    expect(res.counts_toward_balance).toBe(true);
    expect(res.amount).toBe('2000.00');
    expect(res.intake).toEqual({
      id: 'intake-1',
      code: 'KPG-IN-20260908-04412',
      voided_at: null,
    });
  });

  it('does not count once the row itself is voided', () => {
    const res = toIntakeTopUpResponse(
      row({
        voided_at: new Date('2026-09-12T09:00:00.000Z'),
        voided_by_user_id: 'owner-1',
        void_reason: 'помилка суми',
      }),
      parent(),
    );

    expect(res.counts_toward_balance).toBe(false);
    expect(res.voided_at).toBe('2026-09-12T09:00:00.000Z');
    expect(res.void_reason).toBe('помилка суми');
  });

  it('does not count when the PARENT is voided, and says so through the parent', () => {
    const res = toIntakeTopUpResponse(row(), parent(new Date('2026-09-12T09:00:00.000Z')));

    expect(res.counts_toward_balance).toBe(false);
    expect(res.voided_at).toBeNull();
    expect(res.intake.voided_at).toBe('2026-09-12T09:00:00.000Z');
  });

  it('renders timestamps as ISO strings', () => {
    expect(toIntakeTopUpResponse(row(), parent()).created_at).toBe('2026-09-11T08:00:00.000Z');
  });
});
