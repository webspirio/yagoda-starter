import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { IntakesService } from './intakes.service';
import { ShiftStatus } from '../shifts/shift-status.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';
const SHIFT_ID = '33333333-3333-3333-3333-333333333333';
const SUPPLIER = '44444444-4444-4444-4444-444444444444';
const GRADE = '55555555-5555-5555-5555-555555555555';
const CRATE = '66666666-6666-6666-6666-666666666666';
const INTAKE_ID = '77777777-7777-7777-7777-777777777777';

const owner = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};
const oksana = {
  sub: 'u-oksana',
  username: 'oksana',
  role: UserRole.PointOperator,
  collection_point_id: POINT_A,
};
// §10.6's mid-day cashier swap: a SECOND operator at the SAME point.
const maria = {
  sub: 'u-maria',
  username: 'maria',
  role: UserRole.PointOperator,
  collection_point_id: POINT_A,
};
const elsewhere = {
  sub: 'u-b',
  username: 'b',
  role: UserRole.PointOperator,
  collection_point_id: POINT_B,
};

describe('IntakesService', () => {
  let repo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let itemRepo: { find: jest.Mock };
  let manager: { getRepository: jest.Mock; save: jest.Mock; create: jest.Mock; findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let shifts: { findOpenAtPoint: jest.Mock; findOneRaw: jest.Mock };
  let suppliers: { findOne: jest.Mock };
  let prices: { currentFor: jest.Mock };
  let tare: { findManyRaw: jest.Mock };
  let points: { findOneRaw: jest.Mock };
  let audit: { record: jest.Mock };
  let service: IntakesService;

  const shift = (over: Record<string, unknown> = {}) => ({
    id: SHIFT_ID,
    collection_point_id: POINT_A,
    business_date: '2026-09-08',
    closed_at: null,
    status: ShiftStatus.Open,
    ...over,
  });

  const intake = (over: Record<string, unknown> = {}) => ({
    id: INTAKE_ID,
    code: 'KPG-IN-20260908-04412',
    shift_id: SHIFT_ID,
    supplier_id: SUPPLIER,
    amount: '2103.30',
    received_by_user_id: 'u-oksana',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: new Date('2026-09-08T07:00:00.000Z'),
    updated_at: new Date('2026-09-08T07:00:00.000Z'),
    ...over,
  });

  const dto = (over: Record<string, unknown> = {}) => ({
    code: '04412',
    supplier_id: SUPPLIER,
    items: [
      {
        product_grade_id: GRADE,
        gross_kg: '42.00',
        pallet_kg: '1.50',
        bonus: '0.00',
        tare: [{ tare_type_id: CRATE, units: 3 }],
      },
    ],
    ...over,
  });

  beforeEach(() => {
    itemRepo = { find: jest.fn().mockResolvedValue([]) };
    manager = {
      getRepository: jest.fn().mockReturnValue(itemRepo),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((_e, v) => Promise.resolve(intake(v))),
      create: jest.fn().mockImplementation((_e, v) => v),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
    };
    repo = { findOne: jest.fn().mockResolvedValue(null), createQueryBuilder: jest.fn() };
    shifts = {
      findOpenAtPoint: jest.fn().mockResolvedValue(shift()),
      findOneRaw: jest.fn().mockResolvedValue(shift()),
    };
    suppliers = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: SUPPLIER, collection_point_id: POINT_A, is_active: true }),
    };
    prices = {
      currentFor: jest.fn().mockResolvedValue({
        product_grade_id: GRADE,
        base_price: '57.00',
        max_markup: '30.00',
        max_discount: '20.00',
      }),
    };
    tare = { findManyRaw: jest.fn().mockResolvedValue([{ id: CRATE, weight_kg: '1.20' }]) };
    points = { findOneRaw: jest.fn().mockResolvedValue({ id: POINT_A, code: 'KPG' }) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    service = new IntakesService(
      repo as never,
      dataSource as never,
      shifts as never,
      suppliers as never,
      prices as never,
      tare as never,
      points as never,
      audit as never,
    );
  });

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
      await service.create(oksana, dto());

      expect(shifts.findOpenAtPoint).toHaveBeenCalledWith(POINT_A, manager);
      expect(savedIntake().shift_id).toBe(SHIFT_ID);
    });

    it('409s when no shift is open at that point', async () => {
      // Not «closed shift» — «no OPEN shift». Both have the same remedy, so one
      // message covers them.
      shifts.findOpenAtPoint.mockResolvedValue(null);

      await expect(service.create(oksana, dto())).rejects.toMatchObject({
        response: { code: 'NO_OPEN_SHIFT' },
      });
    });

    it('composes the code from point code, IN, the SHIFT business date and the typed number', async () => {
      await service.create(oksana, dto());

      expect(savedIntake().code).toBe('KPG-IN-20260908-04412');
    });

    it('uses the SHIFT business date, not today', async () => {
      // A shift opened on the 8th and still open past midnight writes the 8th.
      shifts.findOpenAtPoint.mockResolvedValue(shift({ business_date: '2026-09-04' }));

      await service.create(oksana, dto());

      expect(savedIntake().code).toBe('KPG-IN-20260904-04412');
    });

    it('404s a supplier belonging to another point', async () => {
      suppliers.findOne.mockResolvedValue({
        id: SUPPLIER,
        collection_point_id: POINT_B,
        is_active: true,
      });

      await expect(service.create(oksana, dto())).rejects.toThrow(NotFoundException);
    });

    it('400s an inactive supplier — deactivation must stop something', async () => {
      suppliers.findOne.mockResolvedValue({
        id: SUPPLIER,
        collection_point_id: POINT_A,
        is_active: false,
      });

      await expect(service.create(oksana, dto())).rejects.toMatchObject({
        response: { code: 'SUPPLIER_INACTIVE' },
      });
    });

    it('400s a grade with no current price at this point (§4.5)', async () => {
      prices.currentFor.mockResolvedValue(null);

      await expect(service.create(oksana, dto())).rejects.toMatchObject({
        response: { code: 'GRADE_NOT_PRICED' },
      });
    });

    it('writes lines in order, numbered from 1, with their tare', async () => {
      const saved = await service
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
      await service.create(oksana, dto());

      expect(savedIntake().amount).toBe('2103.30');
    });

    it('signs the document with WHO PUNCHED IT', async () => {
      // §10.6 — «підпис під документом належить тому, хто натиснув», not to
      // whoever opened the shift.
      await service.create(maria, dto());

      expect(savedIntake().received_by_user_id).toBe('u-maria');
    });

    it('runs the whole write in ONE transaction', async () => {
      // §2.3 — one visit is ONE document. A partially written intake is a
      // receipt that does not match the paper in the supplier's hand.
      await service.create(oksana, dto());

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('translates a duplicate code into a 409 naming the day', async () => {
      manager.save.mockRejectedValue({ code: '23505', constraint: 'UQ_intakes_code' });

      await expect(service.create(oksana, dto())).rejects.toMatchObject({
        response: { code: 'INTAKE_CODE_TAKEN' },
      });
    });

    it('audits intake.created with the composed code', async () => {
      await service.create(oksana, dto());

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'intake.created',
          actor_id: 'u-oksana',
          after: expect.objectContaining({ code: 'KPG-IN-20260908-04412' }),
        }),
        manager,
      );
    });
  });

  describe('void', () => {
    beforeEach(() => {
      // Only the transactional manager is stocked: the locked read is the only
      // one this path may use, so a regression to `repo.findOne` 404s loudly
      // instead of passing.
      manager.findOne.mockResolvedValue(intake());
      shifts.findOneRaw.mockResolvedValue(shift());
    });

    /**
     * The state check has to happen under the lock the write holds. Read
     * `voided_at` before the transaction opens and two requests — a
     * double-tapped button, a retry on a slow response — both see null and both
     * write, leaving two `intake.voided` audit entries with possibly different
     * actors and reasons and a last-writer-wins `voided_by_user_id`. §9.3's
     * «спроба сторнувати той самий документ удруге → кнопки просто немає» is a
     * statement about the record, not just the button.
     */
    it('reads the row under a row lock, inside the transaction', async () => {
      await service.void(oksana, INTAKE_ID, { reason: 'помилка ваги' });

      expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
        where: { id: INTAKE_ID },
        lock: { mode: 'pessimistic_write' },
      });
      expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
        manager.findOne.mock.invocationCallOrder[0],
      );
    });

    it('reads the shift inside the same transaction', async () => {
      await service.void(oksana, INTAKE_ID, { reason: 'помилка ваги' });

      expect(shifts.findOneRaw).toHaveBeenCalledWith(SHIFT_ID, manager);
    });

    it('lets an operator void THEIR OWN intake while the shift is open', async () => {
      await expect(
        service.void(oksana, INTAKE_ID, { reason: 'помилка ваги' }),
      ).resolves.toBeDefined();
    });

    /**
     * §9.4 — «чужа квитанція → приймальник НІКОЛИ, навіть на своїй точці і в ту
     * саму зміну». Not hypothetical: §10.6 describes Оксана leaving her account
     * at 14:00 and Марія entering hers at 14:01, both signing receipts inside
     * ONE shift at ONE point. A point-scoped rule would let Марія void Оксана's.
     */
    it('403s an operator voiding a COLLEAGUE’s intake in the same open shift', async () => {
      await expect(service.void(maria, INTAKE_ID, { reason: 'не моя' })).rejects.toMatchObject({
        response: { code: 'NOT_YOUR_DOCUMENT' },
      });
    });

    it('403s the author once the shift is closed', async () => {
      // §9.4's second row — «квитанція минулого дня → тільки керівник» — and the
      // freeze line the shift close draws.
      shifts.findOneRaw.mockResolvedValue(
        shift({ closed_at: new Date(), status: ShiftStatus.Closed }),
      );

      await expect(service.void(oksana, INTAKE_ID, { reason: 'пізно' })).rejects.toMatchObject({
        response: { code: 'SHIFT_CLOSED' },
      });
    });

    it('lets the owner void a colleague’s intake in a closed shift', async () => {
      shifts.findOneRaw.mockResolvedValue(
        shift({ closed_at: new Date(), status: ShiftStatus.Closed }),
      );

      await expect(service.void(owner, INTAKE_ID, { reason: 'перевірка' })).resolves.toBeDefined();
    });

    it('404s an intake at another point for an operator', async () => {
      await expect(service.void(elsewhere, INTAKE_ID, { reason: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('409s an already-voided intake', async () => {
      // §9.3 — «спроба сторнувати той самий документ удруге → кнопки просто немає».
      manager.findOne.mockResolvedValue(
        intake({ voided_at: new Date(), voided_by_user_id: 'u-owner', void_reason: 'вже' }),
      );

      await expect(service.void(owner, INTAKE_ID, { reason: 'ще раз' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('writes the whole trio and audits with the reason', async () => {
      await service.void(oksana, INTAKE_ID, { reason: 'помилка ваги: 62,40 замість 26,40' });

      const saved = manager.save.mock.calls[0][1] as Record<string, unknown>;
      expect(saved.voided_at).toBeInstanceOf(Date);
      expect(saved.voided_by_user_id).toBe('u-oksana');
      expect(saved.void_reason).toBe('помилка ваги: 62,40 замість 26,40');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'intake.voided', note: expect.any(String) }),
        manager,
      );
    });

    it('does NOT refuse a void that drives the supplier’s debt negative', async () => {
      // «сторно КВИТАНЦІЇ ЄДИНИЙ шлях у мінус, і воно ДОЗВОЛЕНЕ, з попередженням».
      // There is no balance lookup in this path at all, and adding a floor check
      // would contradict «інваріанта борг >= 0 в цій схемі теж немає».
      await expect(service.void(owner, INTAKE_ID, { reason: 'сторно' })).resolves.toBeDefined();
    });
  });

  describe('there is no update path', () => {
    it('exposes no method that mutates a posted document’s numbers', () => {
      // §2.7 — «після проведення не міняється НІКОЛИ». §9.3 — «Часткового сторно
      // немає. Тільки повне + новий правильний документ». This asserts the
      // SHAPE of the service, which is the cheapest place to catch a PATCH
      // being added back.
      expect((service as unknown as Record<string, unknown>).update).toBeUndefined();
    });
  });
});
