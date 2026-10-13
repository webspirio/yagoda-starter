import { In } from 'typeorm';
import { User } from '../../users/user.entity';
import { GetPayoutQuery } from './get-payout.query';
import { oksana, payout, shift } from '../../testing/unit/payouts.mocks';

describe('GetPayoutQuery', () => {
  // The payer is NOT the viewer: an owner reprinting an operator's payout is the path this
  // read exists for, so the lookup must use paid_by_user_id, never actor.sub.
  const PAYER = 'u-maria';
  const build = (user: unknown) => {
    const visible = {
      load: jest
        .fn()
        .mockResolvedValue({ payout: payout({ paid_by_user_id: PAYER }), shift: shift() }),
    };
    const find = jest.fn().mockResolvedValue(user ? [{ id: PAYER, ...(user as object) }] : []);
    const dataSource = { manager: { find } };
    return { query: new GetPayoutQuery(visible as never, dataSource as never), find };
  };

  it('carries the name parts of the user in paid_by_user_id', async () => {
    const { query, find } = build({ first_name: 'Марія', last_name: 'Коваль' });

    const res = await query.get(oksana, 'p-1');

    expect(res.paid_by).toEqual({ first_name: 'Марія', last_name: 'Коваль' });
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ where: { id: In([PAYER]) } }),
    );
  });

  it('answers null if the user row is gone', async () => {
    const { query } = build(null);

    expect((await query.get(oksana, 'p-1')).paid_by).toBeNull();
  });
});
