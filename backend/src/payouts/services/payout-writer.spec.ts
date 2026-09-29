import { IsNull } from 'typeorm';
import {
  POINT_A,
  SUPPLIER,
  oksana,
  owner,
  payout,
  makePayoutsMocks,
  buildPayouts,
  type PayoutsMocks,
} from '../../testing/unit/payouts.mocks';
import { PayoutWriter } from './payout-writer';

describe('PayoutWriter', () => {
  let manager: PayoutsMocks['manager'];
  let dataSource: PayoutsMocks['dataSource'];
  let audit: PayoutsMocks['audit'];
  let allocations: PayoutsMocks['allocations'];
  let writer: PayoutWriter;

  beforeEach(() => {
    const mocks = makePayoutsMocks();
    ({ manager, dataSource, audit, allocations } = mocks);
    writer = buildPayouts(mocks).writer;
  });

  describe('PayoutWriter.write', () => {
    it('stamps intake_id when handed one, and leaves it null otherwise', async () => {
      const INTAKE = '88888888-8888-8888-8888-888888888888';
      await dataSource.transaction(async (m: never) => {
        await writer.write(m, {
          actor: oksana,
          pointId: POINT_A,
          pointCode: 'KPG',
          supplierId: SUPPLIER,
          amount: '380.00',
          intakeId: INTAKE,
        });
      });
      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          intake_id: INTAKE,
          amount: '380.00',
          paid_by_user_id: 'u-oksana',
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payout.created',
          after: expect.objectContaining({ intake_id: INTAKE }),
        }),
        manager,
      );
      // §4.2 — the writer takes no supplier lock; that is the caller's job.
      expect(allocations.lockSupplier).not.toHaveBeenCalled();
    });

    it('leaves intake_id null for a standalone payout — «Видати без ягоди»', async () => {
      await dataSource.transaction(async (m: never) => {
        await writer.write(m, {
          actor: oksana,
          pointId: POINT_A,
          pointCode: 'KPG',
          supplierId: SUPPLIER,
          amount: '380.00',
          intakeId: null,
        });
      });
      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ intake_id: null, amount: '380.00', paid_by_user_id: 'u-oksana' }),
      );
    });
  });

  describe('helpers used by the intake void', () => {
    it('findLiveBoundToIntake locks the live payout bound to the intake', async () => {
      manager.findOne.mockResolvedValue(payout());

      await writer.findLiveBoundToIntake(manager as never, 'intake-1');

      expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
        where: { intake_id: 'intake-1', voided_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('void writes the trio and audits payout.voided', async () => {
      const row = payout();

      await writer.void(manager as never, oksana, row as never, 'помилка', false);

      const saved = manager.save.mock.calls[0][1] as Record<string, unknown>;
      expect(saved).toMatchObject({ voided_by_user_id: oksana.sub, void_reason: 'помилка' });
      expect(saved.voided_at).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payout.voided', target_id: row.id, note: 'помилка' }),
        manager,
      );
    });

    it('void releases the payout and does not allocate — the caller allocates', async () => {
      const row = payout();

      await writer.void(manager as never, oksana, row as never, 'r', false);

      expect(allocations.release).toHaveBeenCalledWith(manager, { payoutId: row.id });
      expect(allocations.allocate).not.toHaveBeenCalled();
    });

    it('void with returnToDrawer stamps the return at the void’s own instant', async () => {
      const row = payout();

      await writer.void(manager as never, oksana, row as never, 'повернув', true);

      const saved = manager.save.mock.calls[0][1] as Record<string, unknown>;
      expect(saved.returned_on_void).toBe(true);
      expect(saved.return_settled_at).toBe(saved.voided_at);
      expect(saved.return_settled_by_user_id).toBe(oksana.sub);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payout.voided',
          after: expect.objectContaining({ returned_on_void: true }),
        }),
        manager,
      );
    });

    it('void without returnToDrawer leaves the return pending', async () => {
      const row = payout();

      await writer.void(manager as never, owner, row as never, 'r', false);

      const saved = manager.save.mock.calls[0][1] as Record<string, unknown>;
      expect(saved.returned_on_void).toBe(false);
      expect(saved.return_settled_at).toBeNull();
    });

    it('settleReturn records the return and audits payout.return-settled', async () => {
      const row = payout({ voided_at: new Date() });

      await writer.settleReturn(manager as never, owner, row as never, 'повернув');

      const saved = manager.save.mock.calls[0][1] as Record<string, unknown>;
      expect(saved).toMatchObject({
        return_settled_by_user_id: owner.sub,
        return_note: 'повернув',
      });
      expect(saved.return_settled_at).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payout.return-settled', note: 'повернув' }),
        manager,
      );
    });
  });
});
