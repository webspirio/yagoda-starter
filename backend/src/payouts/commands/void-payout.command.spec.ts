import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  SHIFT_ID,
  SUPPLIER,
  PAYOUT_ID,
  owner,
  oksana,
  maria,
  elsewhere,
  shift,
  payout,
  makePayoutsMocks,
  buildPayouts,
  type PayoutsMocks,
} from '../../testing/unit/payouts.mocks';
import { VoidPayoutCommand } from './void-payout.command';

describe('VoidPayoutCommand', () => {
  let manager: PayoutsMocks['manager'];
  let dataSource: PayoutsMocks['dataSource'];
  let shifts: PayoutsMocks['shifts'];
  let allocations: PayoutsMocks['allocations'];
  let command: VoidPayoutCommand;

  beforeEach(() => {
    const mocks = makePayoutsMocks();
    ({ manager, dataSource, shifts, allocations } = mocks);
    command = buildPayouts(mocks).voidCmd;
  });

  const saved = () => manager.save.mock.calls[0][1] as Record<string, unknown>;

  describe('void', () => {
    beforeEach(() => {
      // The LOCKED read is the only one this path may use, so only the
      // transactional manager is stocked. `repo.findOne` still answers null: a
      // regression to the unlocked read 404s instead of passing quietly.
      manager.findOne.mockResolvedValue(payout());
      shifts.findOneRaw.mockResolvedValue(shift());
    });

    /**
     * CHECK-THEN-WRITE, AND THE CHECK MUST BE UNDER THE WRITE'S LOCK. Loading
     * the row and reading `voided_at` before the transaction opens lets a
     * double-tapped button — or a client retry on a slow response, the exact
     * scenario the ceiling took a lock for — put two `payout.voided` entries in
     * the audit log with different actors and different reasons, and leave
     * `voided_by_user_id` as last-writer-wins. §6.5's «409 if already voided»
     * is then decorative.
     */
    it('reads the row under a row lock, inside the transaction', async () => {
      await command.void(oksana, PAYOUT_ID, { reason: 'помилка' });

      expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
        where: { id: PAYOUT_ID },
        lock: { mode: 'pessimistic_write' },
      });
      // ORDER, as in `create`: a lock taken after the state check protects
      // nothing.
      expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
        manager.findOne.mock.invocationCallOrder[0],
      );
    });

    it('reads the shift inside the same transaction', async () => {
      await command.void(oksana, PAYOUT_ID, { reason: 'помилка' });

      expect(shifts.findOneRaw).toHaveBeenCalledWith(SHIFT_ID, manager);
    });

    it('follows the same §9.4 authority rule as intakes', async () => {
      await expect(command.void(oksana, PAYOUT_ID, { reason: 'помилка' })).resolves.toBeDefined();
      await expect(command.void(maria, PAYOUT_ID, { reason: 'не моя' })).rejects.toMatchObject({
        response: { code: 'NOT_YOUR_DOCUMENT' },
      });
      await expect(command.void(elsewhere, PAYOUT_ID, { reason: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does NOT touch return_settled_at', async () => {
      // §9.3 — «каса НЕ виросла на 8 000». Voiding and the money coming back
      // are two separate events; conflating them is the theft the rule names.
      await command.void(oksana, PAYOUT_ID, { reason: 'помилка' });

      expect(saved().return_settled_at).toBeNull();
    });

    it('409s an already voided payout', async () => {
      manager.findOne.mockResolvedValue(
        payout({ voided_at: new Date(), voided_by_user_id: 'u-owner', void_reason: 'вже' }),
      );

      await expect(command.void(owner, PAYOUT_ID, { reason: 'ще' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('locks the supplier before the payout row, releases, then allocates once', async () => {
      await command.void(oksana, PAYOUT_ID, { reason: 'помилка' });

      const rowLockIndex = manager.findOne.mock.calls.findIndex(
        ([, options]: [unknown, { lock?: unknown }]) => options?.lock,
      );
      expect(allocations.lockSupplier.mock.invocationCallOrder[0]).toBeLessThan(
        manager.findOne.mock.invocationCallOrder[rowLockIndex],
      );
      expect(allocations.release).toHaveBeenCalledWith(manager, { payoutId: PAYOUT_ID });
      expect(allocations.allocate).toHaveBeenCalledTimes(1);
      expect(allocations.allocate).toHaveBeenCalledWith(manager, SUPPLIER);
    });

    it('is 404 before any lock for a missing payout', async () => {
      manager.findOne.mockResolvedValueOnce(null); // the unlocked stub read

      await expect(command.void(owner, 'nope', { reason: 'x' })).rejects.toThrow(
        'Payout not found',
      );
      expect(allocations.lockSupplier).not.toHaveBeenCalled();
    });

    it('other point is still 404 for an operator, and nothing is released', async () => {
      await expect(command.void(elsewhere, PAYOUT_ID, { reason: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      expect(allocations.release).not.toHaveBeenCalled();
    });
  });
});
