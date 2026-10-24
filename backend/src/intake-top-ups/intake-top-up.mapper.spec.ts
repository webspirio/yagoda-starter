import { IntakeTopUp } from './intake-top-up.entity';
import { toIntakeTopUpResponse, topUpUserIds } from './intake-top-up.mapper';

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

const NO_NAMES = new Map<string, string>();

describe('toIntakeTopUpResponse', () => {
  it('counts toward the balance when both the row and its parent are live', () => {
    const res = toIntakeTopUpResponse(row(), parent(), NO_NAMES);

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
      NO_NAMES,
    );

    expect(res.counts_toward_balance).toBe(false);
    expect(res.voided_at).toBe('2026-09-12T09:00:00.000Z');
    expect(res.void_reason).toBe('помилка суми');
  });

  it('does not count when the PARENT is voided, and says so through the parent', () => {
    const res = toIntakeTopUpResponse(
      row(),
      parent(new Date('2026-09-12T09:00:00.000Z')),
      NO_NAMES,
    );

    expect(res.counts_toward_balance).toBe(false);
    expect(res.voided_at).toBeNull();
    expect(res.intake.voided_at).toBe('2026-09-12T09:00:00.000Z');
  });

  it('renders timestamps as ISO strings', () => {
    expect(toIntakeTopUpResponse(row(), parent(), NO_NAMES).created_at).toBe(
      '2026-09-11T08:00:00.000Z',
    );
  });

  // Review 2026-10-24 #7: who added it and who voided it, read off the caller's batched map.
  it('names the author and the voider from the caller’s map', () => {
    const names = new Map([
      ['owner-1', 'Олена Коваль'],
      ['owner-2', 'Іван Мельник'],
    ]);
    const live = toIntakeTopUpResponse(row(), parent(), names);
    expect(live.created_by_name).toBe('Олена Коваль');
    expect(live.voided_by_name).toBeNull();

    const voided = toIntakeTopUpResponse(
      row({
        voided_at: new Date('2026-09-12T09:00:00.000Z'),
        voided_by_user_id: 'owner-2',
        void_reason: 'помилка суми',
      }),
      parent(),
      names,
    );
    expect(voided.voided_by_name).toBe('Іван Мельник');
  });

  it('reads a name it cannot find as null, never a guess', () => {
    const res = toIntakeTopUpResponse(
      row({ voided_at: new Date(), voided_by_user_id: 'gone', void_reason: 'x' }),
      parent(),
      NO_NAMES,
    );
    expect(res.created_by_name).toBeNull();
    expect(res.voided_by_name).toBeNull();
  });
});

describe('topUpUserIds', () => {
  it('lists the author of every row and the voider of a voided one', () => {
    expect(
      topUpUserIds([
        { created_by_user_id: 'a', voided_by_user_id: null },
        { created_by_user_id: 'b', voided_by_user_id: 'c' },
      ]),
    ).toEqual(['a', 'b', 'c']);
  });
});
