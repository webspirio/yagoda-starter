import { GetPayoutQuery } from './get-payout.query';
import { oksana, payout, shift } from '../../testing/unit/payouts.mocks';

describe('GetPayoutQuery', () => {
  const build = (user: unknown) => {
    const visible = { load: jest.fn().mockResolvedValue({ payout: payout(), shift: shift() }) };
    const find = jest.fn().mockResolvedValue(user ? [{ id: 'u-oksana', ...(user as object) }] : []);
    const dataSource = { manager: { find } };
    return { query: new GetPayoutQuery(visible as never, dataSource as never), find };
  };

  it('carries the name parts of the user in paid_by_user_id', async () => {
    const { query, find } = build({ first_name: 'Оксана', last_name: 'Гнатюк' });

    const res = await query.get(oksana, 'p-1');

    expect(res.paid_by).toEqual({ first_name: 'Оксана', last_name: 'Гнатюк' });
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('answers null if the user row is gone', async () => {
    const { query } = build(null);

    expect((await query.get(oksana, 'p-1')).paid_by).toBeNull();
  });
});
