import { readdirSync } from 'fs';
import { NotFoundException } from '@nestjs/common';
import {
  makeIntakesMocks,
  buildIntakes,
  type IntakesMocks,
  oksana,
  maria,
  dto,
  shift,
  POINT_A,
  POINT_B,
  SHIFT_ID,
  SUPPLIER,
  GRADE,
  CRATE,
  INTAKE_ID,
} from '../../testing/unit/intakes.mocks';
import { CreateIntakeCommand } from './create-intake.command';

describe('CreateIntakeCommand', () => {
  let manager: IntakesMocks['manager'];
  let dataSource: IntakesMocks['dataSource'];
  let shifts: IntakesMocks['shifts'];
  let suppliers: IntakesMocks['suppliers'];
  let prices: IntakesMocks['prices'];
  let audit: IntakesMocks['audit'];
  let payouts: IntakesMocks['payouts'];
  let allocations: IntakesMocks['allocations'];
  let command: CreateIntakeCommand;

  beforeEach(() => {
    const mocks = makeIntakesMocks();
    ({ manager, dataSource, shifts, suppliers, prices, audit, payouts, allocations } = mocks);
    command = buildIntakes(mocks).create;
  });

  /** The invocation order of `nextDocumentCode`'s advisory lock on the transactional manager. */
  const advisoryOrder = () => {
    const i = manager.query.mock.calls.findIndex(([sql]) =>
      /pg_advisory_xact_lock/.test(sql as string),
    );
    return manager.query.mock.invocationCallOrder[i];
  };

  const savedIntake = () =>
    manager.save.mock.calls[0][1] as {
      code: string;
      amount: string;
      shift_id: string;
      received_by_user_id: string;
      items: { item_order: number; net_kg: string; amount: string; tare: unknown[] }[];
    };

  describe('create', () => {
    it('resolves the point from the operator token and the shift from the point', async () => {
      await command.create(oksana, dto());

      expect(shifts.findOpenAtPoint).toHaveBeenCalledWith(POINT_A, manager);
      expect(savedIntake().shift_id).toBe(SHIFT_ID);
    });

    it('409s when no shift is open at that point', async () => {
      // Not «closed shift» — «no OPEN shift». Both have the same remedy, so one
      // message covers them.
      shifts.findOpenAtPoint.mockResolvedValue(null);

      await expect(command.create(oksana, dto())).rejects.toMatchObject({
        response: { code: 'NO_OPEN_SHIFT' },
      });
    });

    it('composes the code from point code, IN, the SHIFT business date and the sequence', async () => {
      await command.create(oksana, dto());

      expect(savedIntake().code).toBe('KPG-IN-20260908-004');
    });

    it('numbers from the documents already in THIS shift, not from anything sent', async () => {
      manager.query.mockImplementation((sql: string) =>
        Promise.resolve(sql.includes('pg_advisory_xact_lock') ? [{}] : [{ n: 0 }]),
      );

      await command.create(oksana, dto());

      expect(savedIntake().code).toBe('KPG-IN-20260908-001');
    });

    it('counts intakes, not every document in the shift', async () => {
      await command.create(oksana, dto());

      const counting = (manager.query.mock.calls as [string][]).find(([sql]) =>
        sql.includes('count(*)'),
      );
      expect(counting?.[0]).toContain('FROM intakes');
    });

    it('uses the SHIFT business date, not today', async () => {
      // A shift opened on the 8th and still open past midnight writes the 8th.
      shifts.findOpenAtPoint.mockResolvedValue(shift({ business_date: '2026-09-04' }));

      await command.create(oksana, dto());

      expect(savedIntake().code).toBe('KPG-IN-20260904-004');
    });

    it('404s a supplier belonging to another point', async () => {
      suppliers.findOne.mockResolvedValue({
        id: SUPPLIER,
        collection_point_id: POINT_B,
        is_active: true,
      });

      await expect(command.create(oksana, dto())).rejects.toThrow(NotFoundException);
    });

    it('400s an inactive supplier — deactivation must stop something', async () => {
      suppliers.findOne.mockResolvedValue({
        id: SUPPLIER,
        collection_point_id: POINT_A,
        is_active: false,
      });

      await expect(command.create(oksana, dto())).rejects.toMatchObject({
        response: { code: 'SUPPLIER_INACTIVE' },
      });
    });

    it('400s a grade with no current price at this point (§4.5)', async () => {
      prices.currentFor.mockResolvedValue(null);

      await expect(command.create(oksana, dto())).rejects.toMatchObject({
        response: { code: 'GRADE_NOT_PRICED' },
      });
    });

    it('writes lines in order, numbered from 1, with their tare', async () => {
      const saved = await command
        .create(oksana, {
          ...dto(),
          items: [
            ...dto().items,
            {
              product_grade_id: GRADE,
              gross_kg: '20.00',
              pallet_kg: '0.00',
              bonus: '-2.00',
              tare: [{ tare_type_id: CRATE, units: 1 }],
            },
          ],
        })
        .then(() => savedIntake());

      expect(saved.items.map((i) => i.item_order)).toEqual([1, 2]);
      expect(saved.items[0].net_kg).toBe('36.90');
      expect(saved.items[0].tare).toHaveLength(1);
    });

    it('stores amount as Σ of the line amounts', async () => {
      await command.create(oksana, dto());

      expect(savedIntake().amount).toBe('2103.30');
    });

    it('signs the document with WHO PUNCHED IT', async () => {
      // §10.6 — «підпис під документом належить тому, хто натиснув», not to
      // whoever opened the shift.
      await command.create(maria, dto());

      expect(savedIntake().received_by_user_id).toBe('u-maria');
    });

    it('runs the whole write in ONE transaction', async () => {
      // §2.3 — one visit is ONE document. A partially written intake is a
      // receipt that does not match the paper in the supplier's hand.
      await command.create(oksana, dto());

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('translates a duplicate code into a 409 naming the code', async () => {
      manager.save.mockRejectedValue({ code: '23505', constraint: 'UQ_intakes_code' });

      await expect(command.create(oksana, dto())).rejects.toMatchObject({
        response: { code: 'INTAKE_CODE_TAKEN' },
      });
    });

    it('audits intake.created with the composed code', async () => {
      await command.create(oksana, dto());

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'intake.created',
          actor_id: 'u-oksana',
          after: expect.objectContaining({ code: 'KPG-IN-20260908-004' }),
        }),
        manager,
      );
    });

    it('locks the supplier before numbering and allocates once, at the end', async () => {
      await command.create(oksana, dto({ paid_amount: '100.00' }));

      expect(allocations.lockSupplier).toHaveBeenCalledWith(manager, SUPPLIER);
      expect(allocations.lockSupplier.mock.invocationCallOrder[0]).toBeLessThan(advisoryOrder());
      expect(allocations.allocate).toHaveBeenCalledTimes(1);
      expect(allocations.allocate).toHaveBeenCalledWith(manager, SUPPLIER);
      expect(allocations.allocate.mock.invocationCallOrder[0]).toBeGreaterThan(
        payouts.write.mock.invocationCallOrder[0],
      );
    });

    it('throws if the row-extras read comes back empty — `list`’s guard, mirrored', async () => {
      // Same shape as `list`'s `if (!row) throw new Error(...)` guard over its
      // `byId` map — `extras`'s own signature promises a non-null
      // `IntakeRowExtras`, and until this guard existed a missing row (the
      // insert committed but `ROW_EXTRAS_SQL` found nothing for its id — a
      // read-your-own-write bug, not a real-world case) would have handed
      // `undefined` to `toIntakeDetailResponse` and failed far from here with
      // no clue which intake was involved.
      manager.query.mockImplementation((sql: string) =>
        Promise.resolve(
          sql.includes('pg_advisory_xact_lock')
            ? [{}]
            : sql.includes('AS net_kg')
              ? []
              : [{ n: 3 }],
        ),
      );

      await expect(command.create(oksana, dto())).rejects.toThrow(/intake row extras missing for/);
    });

    it('reads the row extras AFTER allocating, so open_amount reflects this receipt’s allocations', async () => {
      await command.create(oksana, dto());
      const extrasCall = manager.query.mock.calls.findIndex(([sql]) =>
        /AS net_kg/.test(sql as string),
      );
      expect(manager.query.mock.invocationCallOrder[extrasCall]).toBeGreaterThan(
        allocations.allocate.mock.invocationCallOrder[0],
      );
    });
  });

  describe('paid at reception (§2.1 ⑥, §3.1)', () => {
    it('writes no payout when paid_amount is absent', async () => {
      const res = await command.create(oksana, dto() as never);
      expect(payouts.write).not.toHaveBeenCalled();
      expect(res.payouts).toEqual([]);
    });

    it('writes no payout for 0.00 — «видано 0,00» is an intake with no payout', async () => {
      await command.create(oksana, dto({ paid_amount: '0.00' }) as never);
      expect(payouts.write).not.toHaveBeenCalled();
    });

    it('writes no payout for an explicit null — truthiness, not `!== undefined`', async () => {
      const res = await command.create(oksana, dto({ paid_amount: null }) as never);
      expect(payouts.write).not.toHaveBeenCalled();
      expect(res.payouts).toEqual([]);
    });

    it('hands the cash to write AFTER the intake is saved, stamped with its id', async () => {
      const res = await command.create(oksana, dto({ paid_amount: '380.00' }) as never);
      expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
        payouts.write.mock.invocationCallOrder[0],
      );
      expect(payouts.write).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          actor: oksana,
          pointId: POINT_A,
          pointCode: 'KPG',
          supplierId: SUPPLIER,
          amount: '380.00',
          intakeId: INTAKE_ID,
        }),
      );
      expect(res.payouts).toEqual([
        { id: 'po-1', code: 'KPG-PO-20260908-001', amount: '380.00', voided_at: null },
      ]);
    });

    it('lets a ceiling refusal roll the whole transaction back', async () => {
      payouts.write.mockRejectedValue(new Error('PAYOUT_EXCEEDS_CASH'));
      await expect(command.create(oksana, dto({ paid_amount: '380.00' }) as never)).rejects.toThrow(
        'PAYOUT_EXCEEDS_CASH',
      );
      // The mock `transaction` just runs the callback; the real one rolls back
      // on a throw. What this asserts is that the throw is not swallowed.
    });
  });

  describe('there is no update path', () => {
    it('exposes no method that mutates a posted document’s numbers', () => {
      // §2.7 — «після проведення не міняється НІКОЛИ». §9.3 — «Часткового сторно
      // немає. Тільки повне + новий правильний документ». This asserts the
      // SHAPE of the write surface, which is the cheapest place to catch a
      // PATCH being added back.
      const commands = readdirSync(__dirname).filter((f) => f.endsWith('.command.ts'));
      expect(commands.sort()).toEqual(['create-intake.command.ts', 'void-intake.command.ts']);
      expect((command as unknown as Record<string, unknown>).update).toBeUndefined();
    });
  });
});
