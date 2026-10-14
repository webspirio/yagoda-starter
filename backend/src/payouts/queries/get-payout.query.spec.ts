import { CollectionPoint } from '../../collection-points/collection-point.entity';
import { User } from '../../users/user.entity';
import { GetPayoutQuery } from './get-payout.query';
import { maria, oksana, payout, shift } from '../../testing/unit/payouts.mocks';

describe('GetPayoutQuery', () => {
  // The payer is NOT the viewer: an owner reprinting an operator's payout is the path this
  // read exists for, so the lookup must use paid_by_user_id, never actor.sub.
  const PAYER = maria.sub;
  const build = (payerNumber: number | null) => {
    const visible = {
      load: jest
        .fn()
        .mockResolvedValue({ payout: payout({ paid_by_user_id: PAYER }), shift: shift() }),
    };
    const findOne = jest
      .fn()
      .mockResolvedValue(payerNumber === null ? null : { id: PAYER, number: payerNumber });
    const findOneOrFail = jest.fn().mockResolvedValue({ id: shift().collection_point_id, number: 7 });
    const dataSource = { manager: { findOne, findOneOrFail } };
    return {
      query: new GetPayoutQuery(visible as never, dataSource as never),
      findOne,
      findOneOrFail,
    };
  };

  it('carries the number of the user in paid_by_user_id', async () => {
    const { query, findOne } = build(3);

    const res = await query.get(oksana, 'p-1');

    expect(res.paid_by_number).toBe(3);
    expect(findOne).toHaveBeenCalledWith(
      User,
      expect.objectContaining({ where: { id: PAYER } }),
    );
  });

  it('carries the number of the point the payout was made at', async () => {
    const { query, findOneOrFail } = build(3);

    expect((await query.get(oksana, 'p-1')).point_number).toBe(7);
    expect(findOneOrFail).toHaveBeenCalledWith(
      CollectionPoint,
      expect.objectContaining({ where: { id: shift().collection_point_id } }),
    );
  });

  it('answers a null payer number if the user row is gone', async () => {
    const { query } = build(null);

    expect((await query.get(oksana, 'p-1')).paid_by_number).toBeNull();
  });
});
