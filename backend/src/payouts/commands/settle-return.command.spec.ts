import { ForbiddenException } from '@nestjs/common';
import {
  PAYOUT_ID,
  owner,
  oksana,
  shift,
  payout,
  makePayoutsMocks,
  buildPayouts,
  type PayoutsMocks,
} from '../../testing/unit/payouts.mocks';
import { SettleReturnCommand } from './settle-return.command';

describe('SettleReturnCommand', () => {
  let manager: PayoutsMocks['manager'];
  let dataSource: PayoutsMocks['dataSource'];
  let shifts: PayoutsMocks['shifts'];
  let command: SettleReturnCommand;

  beforeEach(() => {
    const mocks = makePayoutsMocks();
    ({ manager, dataSource, shifts } = mocks);
    command = buildPayouts(mocks).settle;
  });

  const saved = () => manager.save.mock.calls[0][1] as Record<string, unknown>;

  describe('settleReturn', () => {
    beforeEach(() => {
      manager.findOne.mockResolvedValue(
        payout({ voided_at: new Date(), voided_by_user_id: 'u-oksana', void_reason: 'помилка' }),
      );
      shifts.findOneRaw.mockResolvedValue(shift());
    });

    /**
     * The same race as `void`, and it matters MORE here: this row is the
     * owner's attestation that the cash physically went back in the drawer, and
     * §9.3's whole argument is that the loop must not be closable unobserved. A
     * second, differently-attributed record of one attestation is precisely the
     * ambiguity that argument is about.
     */
    it('reads the row under a row lock, inside the transaction', async () => {
      await command.settle(owner, PAYOUT_ID, {});

      expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
        where: { id: PAYOUT_ID },
        lock: { mode: 'pessimistic_write' },
      });
      expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
        manager.findOne.mock.invocationCallOrder[0],
      );
    });

    it('is refused to an operator at their own point', async () => {
      // The operator who voided the payout is the person holding the drawer.
      // Letting them also certify the refill closes §9.3's loop unobserved —
      // «інакше сторно стає способом красти».
      await expect(command.settle(oksana, PAYOUT_ID, {})).rejects.toThrow(ForbiddenException);
    });

    it('409s a payout that is not voided', async () => {
      manager.findOne.mockResolvedValue(payout());

      await expect(command.settle(owner, PAYOUT_ID, {})).rejects.toMatchObject({
        response: { code: 'PAYOUT_NOT_VOIDED' },
      });
    });

    it('409s a payout already settled', async () => {
      manager.findOne.mockResolvedValue(
        payout({
          voided_at: new Date(),
          voided_by_user_id: 'u-oksana',
          void_reason: 'помилка',
          return_settled_at: new Date(),
          return_settled_by_user_id: 'u-owner',
        }),
      );

      await expect(command.settle(owner, PAYOUT_ID, {})).rejects.toMatchObject({
        response: { code: 'RETURN_ALREADY_SETTLED' },
      });
    });

    it('stamps the settler and stores an optional note', async () => {
      await command.settle(owner, PAYOUT_ID, { note: 'вніс готівку 09.09' });

      expect(saved().return_settled_at).toBeInstanceOf(Date);
      expect(saved().return_settled_by_user_id).toBe('u-owner');
      expect(saved().return_note).toBe('вніс готівку 09.09');
    });

    it('does NOT store the amount', async () => {
      // It always equals `payouts.amount`; a second copy is forbidden by the
      // DBML header and would be the number that goes stale.
      await command.settle(owner, PAYOUT_ID, {});

      expect(saved()).not.toHaveProperty('return_amount');
      expect(saved().return_note).toBeNull();
    });

    it('409s a payout already returned on void', async () => {
      manager.findOne.mockResolvedValue(
        payout({
          voided_at: new Date(),
          voided_by_user_id: 'u-oksana',
          void_reason: 'r',
          return_settled_at: new Date(),
          return_settled_by_user_id: 'u-oksana',
          returned_on_void: true,
        }),
      );
      await expect(command.settle(owner, PAYOUT_ID, {})).rejects.toMatchObject({
        response: { code: 'RETURN_ALREADY_SETTLED' },
      });
    });
  });
});
