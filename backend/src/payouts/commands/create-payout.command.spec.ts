import { NotFoundException } from '@nestjs/common';
import {
  POINT_A,
  POINT_B,
  SUPPLIER,
  oksana,
  maria,
  dto,
  makePayoutsMocks,
  buildPayouts,
  type PayoutsMocks,
} from '../../testing/unit/payouts.mocks';
import { CreatePayoutCommand } from './create-payout.command';

describe('CreatePayoutCommand', () => {
  let manager: PayoutsMocks['manager'];
  let shifts: PayoutsMocks['shifts'];
  let suppliers: PayoutsMocks['suppliers'];
  let balance: PayoutsMocks['balance'];
  let pointCash: PayoutsMocks['pointCash'];
  let audit: PayoutsMocks['audit'];
  let allocations: PayoutsMocks['allocations'];
  let command: CreatePayoutCommand;

  beforeEach(() => {
    const mocks = makePayoutsMocks();
    ({ manager, shifts, suppliers, balance, pointCash, audit, allocations } = mocks);
    command = buildPayouts(mocks).create;
  });

  const saved = () => manager.save.mock.calls[0][1] as Record<string, unknown>;

  describe('create — the debt half of §3.6', () => {
    it('allows a payout equal to the debt', async () => {
      await expect(command.create(oksana, dto({ amount: '380.00' }))).resolves.toBeDefined();
    });

    it('refuses one kopiyka more', async () => {
      await expect(command.create(oksana, dto({ amount: '380.01' }))).rejects.toMatchObject({
        response: { code: 'PAYOUT_EXCEEDS_DEBT' },
      });
    });

    it('names the current balance in the refusal', async () => {
      // The operator cannot see why 500 was refused unless the message says the
      // balance is 380 — otherwise they retry the same number and are refused
      // again. §3.1 already puts that figure on their screen.
      await expect(command.create(oksana, dto({ amount: '500.00' }))).rejects.toThrow(/380\.00/);
    });

    it('compares NUMERICALLY, not as strings', async () => {
      // '9.99' > '10.00' lexically. A string comparison here would let a payout
      // of 9.99 through against a debt of 10.00 and refuse the reverse.
      balance.debtFor.mockResolvedValue('10.00');

      await expect(command.create(oksana, dto({ amount: '9.99' }))).resolves.toBeDefined();
    });

    it('refuses a zero payout with a 400, not a constraint 500', async () => {
      // Spec §8.6. `CHK_payouts_amount` is the guarantee; without this
      // pre-check the violation reaches the client as an opaque 500, since
      // this backend maps no QueryFailedError. The pipeline spec caught it.
      await expect(command.create(oksana, dto({ amount: '0.00' }))).rejects.toMatchObject({
        response: { code: 'PAYOUT_AMOUNT_ZERO' },
      });
    });

    it('refuses any positive payout against a negative balance', async () => {
      // A negative balance means the network owes nothing. The value is left
      // unclamped by design — «інваріанта борг >= 0 в цій схемі немає».
      balance.debtFor.mockResolvedValue('-120.00');

      await expect(command.create(oksana, dto({ amount: '1.00' }))).rejects.toMatchObject({
        response: { code: 'PAYOUT_EXCEEDS_DEBT' },
      });
    });

    it('locks the supplier BEFORE reading the shift or the debt', async () => {
      await command.create(oksana, dto());

      expect(allocations.lockSupplier).toHaveBeenCalledWith(manager, SUPPLIER);
      // ORDER, not just presence: a lock taken AFTER the shift/debt reads
      // protects nothing. `invocationCallOrder` is the vanilla-Jest way to
      // assert it — `toHaveBeenCalledBefore` is a jest-extended matcher this
      // repo has not installed.
      expect(allocations.lockSupplier.mock.invocationCallOrder[0]).toBeLessThan(
        shifts.findOpenAtPoint.mock.invocationCallOrder[0],
      );
    });

    it('reads the debt inside the caller’s transaction', async () => {
      // Otherwise the locked value and the checked value are different reads.
      await command.create(oksana, dto());

      expect(balance.debtFor).toHaveBeenCalledWith(SUPPLIER, manager);
    });

    it('composes the code with PO, not IN', async () => {
      await command.create(oksana, dto());

      expect(saved().code).toBe('KPG-PO-20260908-003');
    });

    it('numbers payouts from the payouts table, on their own counter', async () => {
      await command.create(oksana, dto());

      const counting = (manager.query.mock.calls as [string][]).find(([sql]) =>
        sql.includes('count(*)'),
      );
      expect(counting?.[0]).toContain('FROM payouts');
    });

    it('takes the supplier lock BEFORE numbering, so the debt read is the locked one', async () => {
      await command.create(oksana, dto());

      expect(allocations.lockSupplier.mock.invocationCallOrder[0]).toBeLessThan(
        manager.query.mock.invocationCallOrder[0],
      );
      const sqls = (manager.query.mock.calls as [string][]).map(([sql]) => sql);
      expect(sqls.findIndex((sql) => sql.includes('count(*)'))).toBeGreaterThan(0);
    });

    it('409s when no shift is open', async () => {
      shifts.findOpenAtPoint.mockResolvedValue(null);

      await expect(command.create(oksana, dto())).rejects.toMatchObject({
        response: { code: 'NO_OPEN_SHIFT' },
      });
    });

    it('404s a supplier at another point', async () => {
      suppliers.findOne.mockResolvedValue({
        id: SUPPLIER,
        collection_point_id: POINT_B,
        is_active: true,
      });

      await expect(command.create(oksana, dto())).rejects.toThrow(NotFoundException);
    });

    it('signs the document with who pressed the button', async () => {
      await command.create(maria, dto());

      expect(saved().paid_by_user_id).toBe('u-maria');
    });

    it('audits payout.created', async () => {
      await command.create(oksana, dto());

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payout.created' }),
        manager,
      );
    });

    it('allocates once, after the payout is written', async () => {
      await command.create(oksana, dto());

      expect(allocations.allocate).toHaveBeenCalledTimes(1);
      expect(allocations.allocate).toHaveBeenCalledWith(manager, SUPPLIER);
    });
  });

  describe('the cash half of §3.6', () => {
    it('refuses a payout above the cash for berries, NAMING the code', async () => {
      // Debt admits 380, the drawer holds 300: min(Разом, каса) = 300.
      pointCash.cashFor.mockResolvedValue('300.00');
      await expect(command.create(oksana, dto({ amount: '380.00' }))).rejects.toMatchObject({
        response: { code: 'PAYOUT_EXCEEDS_CASH' },
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('allows a payout equal to the cash', async () => {
      pointCash.cashFor.mockResolvedValue('380.00');
      await expect(command.create(oksana, dto({ amount: '380.00' }))).resolves.toMatchObject({
        amount: '380.00',
      });
    });

    it('reads the cash INSIDE the transaction, after the debt AND after the PO advisory lock, under the supplier lock', async () => {
      // Moved 2026-09-21 (PR #137 review): the cash read has to happen under
      // the lock that actually serialises two payouts at one POINT — the
      // supplier row is a per-supplier mutex, so it alone leaves two payouts
      // to two DIFFERENT suppliers free to both read the same drawer. Asserts
      // the FULL new order — supplier lock → debt → `nextDocumentCode`'s
      // advisory lock → cash — not just "cash is somewhere after debt", so a
      // regression back to reading cash before the advisory lock fails here.
      pointCash.cashFor.mockResolvedValue('380.00');
      await command.create(oksana, dto());
      const lockCall = allocations.lockSupplier.mock.invocationCallOrder[0];
      const debtCall = balance.debtFor.mock.invocationCallOrder[0];
      const sqls = (manager.query.mock.calls as [string][]).map(([sql]) => sql);
      const advisoryIndex = sqls.findIndex((sql) => sql.includes('pg_advisory_xact_lock'));
      expect(advisoryIndex).toBeGreaterThanOrEqual(0);
      const advisoryCall = manager.query.mock.invocationCallOrder[advisoryIndex];
      const cashCall = pointCash.cashFor.mock.invocationCallOrder[0];
      expect(lockCall).toBeLessThan(debtCall);
      expect(debtCall).toBeLessThan(advisoryCall);
      expect(advisoryCall).toBeLessThan(cashCall);
      expect(pointCash.cashFor).toHaveBeenCalledWith(POINT_A, undefined, manager);
    });

    it('a negative drawer admits nothing — the reception still proceeds without a payout', async () => {
      pointCash.cashFor.mockResolvedValue('-51130.18');
      await expect(command.create(oksana, dto({ amount: '1.00' }))).rejects.toMatchObject({
        response: { code: 'PAYOUT_EXCEEDS_CASH' },
      });
    });
  });
});
