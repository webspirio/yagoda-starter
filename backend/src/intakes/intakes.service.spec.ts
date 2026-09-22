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
  let repo: { findOne: jest.Mock; createQueryBuilder: jest.Mock; manager: unknown };
  let itemRepo: { find: jest.Mock };
  let manager: {
    getRepository: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    query: jest.Mock;
  };
  /** `dataSource.manager` — the NON-transactional manager `preview` reads
   *  through, and the same object `this.repo.manager` resolves to (a
   *  repository's manager IS the data source's manager outside a
   *  transaction) — so `findOne` reads its extras and receiver name through
   *  this one too. A separate object from `manager` so a test can tell which
   *  of the two a snapshot read went through. */
  let plainManager: {
    getRepository: jest.Mock;
    query: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock; manager: typeof plainManager };
  let shifts: { findOpenAtPoint: jest.Mock; findOneRaw: jest.Mock };
  let suppliers: { findOne: jest.Mock };
  let prices: { currentFor: jest.Mock };
  let tare: { findManyRaw: jest.Mock };
  let points: { findOneRaw: jest.Mock };
  let audit: { record: jest.Mock };
  let payouts: { writePayout: jest.Mock };
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
    code: 'KPG-IN-20260908-004',
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
    // Shared by `manager` and `plainManager`: `extrasFor` reads `ROW_EXTRAS_SQL`
    // (contains `AS net_kg`) and `nextDocumentCode`'s count reads everything
    // else, so branching on the SQL text is what lets one mock answer both.
    const queryExtrasOrCount = (sql: string) =>
      Promise.resolve(
        sql.includes('pg_advisory_xact_lock')
          ? [{}]
          : sql.includes('AS net_kg')
            ? [
                {
                  net_kg: '36.90',
                  lines_count: 2,
                  supplier_name: 'Іван Коваль',
                  paid_amount: '0.00',
                },
              ]
            : // `nextDocumentCode` locks, then counts the documents already in
              // this shift. Three of them, so the next receipt is 004.
              [{ n: 3 }],
      );
    // `nameOf` reads `User` by id; branch on the entity CLASS's `.name` so
    // every other `findOne(Entity, …)` call keeps its own mock untouched.
    const findOneUserOrNull = (entity: { name?: string }) =>
      Promise.resolve(
        entity?.name === 'User' ? { first_name: 'Оксана', last_name: 'Гнатюк' } : null,
      );
    manager = {
      getRepository: jest.fn().mockReturnValue(itemRepo),
      query: jest.fn().mockImplementation(queryExtrasOrCount),
      findOne: jest.fn().mockImplementation(findOneUserOrNull),
      save: jest.fn().mockImplementation((_e, v) => Promise.resolve(intake(v))),
      create: jest.fn().mockImplementation((_e, v) => v),
    };
    plainManager = {
      getRepository: jest.fn().mockReturnValue(itemRepo),
      query: jest.fn().mockImplementation(queryExtrasOrCount),
      findOne: jest.fn().mockImplementation(findOneUserOrNull),
      find: jest.fn().mockResolvedValue([]),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
      manager: plainManager,
    };
    repo = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
      manager: plainManager,
    };
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
    payouts = {
      writePayout: jest.fn().mockImplementation((_m, input: { amount: string; intakeId: string }) =>
        Promise.resolve({
          payout: {
            id: 'po-1',
            code: 'KPG-PO-20260908-001',
            amount: input.amount,
            intake_id: input.intakeId,
            voided_at: null,
          },
          shift: shift(),
        }),
      ),
    };

    service = new IntakesService(
      repo as never,
      dataSource as never,
      shifts as never,
      suppliers as never,
      prices as never,
      tare as never,
      points as never,
      audit as never,
      payouts as never,
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

    it('composes the code from point code, IN, the SHIFT business date and the sequence', async () => {
      await service.create(oksana, dto());

      expect(savedIntake().code).toBe('KPG-IN-20260908-004');
    });

    it('numbers from the documents already in THIS shift, not from anything sent', async () => {
      manager.query.mockImplementation((sql: string) =>
        Promise.resolve(sql.includes('pg_advisory_xact_lock') ? [{}] : [{ n: 0 }]),
      );

      await service.create(oksana, dto());

      expect(savedIntake().code).toBe('KPG-IN-20260908-001');
    });

    it('counts intakes, not every document in the shift', async () => {
      await service.create(oksana, dto());

      const counting = (manager.query.mock.calls as [string][]).find(([sql]) =>
        sql.includes('count(*)'),
      );
      expect(counting?.[0]).toContain('FROM intakes');
    });

    it('uses the SHIFT business date, not today', async () => {
      // A shift opened on the 8th and still open past midnight writes the 8th.
      shifts.findOpenAtPoint.mockResolvedValue(shift({ business_date: '2026-09-04' }));

      await service.create(oksana, dto());

      expect(savedIntake().code).toBe('KPG-IN-20260904-004');
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

    it('translates a duplicate code into a 409 naming the code', async () => {
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
          after: expect.objectContaining({ code: 'KPG-IN-20260908-004' }),
        }),
        manager,
      );
    });

    it('throws if the row-extras read comes back empty — `list`’s guard, mirrored', async () => {
      // Same shape as `list`'s `if (!row) throw new Error(...)` guard over its
      // `byId` map — `extrasFor`'s own signature promises a non-null
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

      await expect(service.create(oksana, dto())).rejects.toThrow(
        /intake row extras missing for/,
      );
    });
  });

  describe('paid at reception (§2.1 ⑥, §3.1)', () => {
    it('writes no payout when paid_amount is absent', async () => {
      const res = await service.create(oksana, dto() as never);
      expect(payouts.writePayout).not.toHaveBeenCalled();
      expect(res.payouts).toEqual([]);
    });

    it('writes no payout for 0.00 — «видано 0,00» is an intake with no payout', async () => {
      await service.create(oksana, dto({ paid_amount: '0.00' }) as never);
      expect(payouts.writePayout).not.toHaveBeenCalled();
    });

    it('writes no payout for an explicit null — truthiness, not `!== undefined`', async () => {
      const res = await service.create(oksana, dto({ paid_amount: null }) as never);
      expect(payouts.writePayout).not.toHaveBeenCalled();
      expect(res.payouts).toEqual([]);
    });

    it('hands the cash to writePayout AFTER the intake is saved, stamped with its id', async () => {
      const res = await service.create(oksana, dto({ paid_amount: '380.00' }) as never);
      expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
        payouts.writePayout.mock.invocationCallOrder[0],
      );
      expect(payouts.writePayout).toHaveBeenCalledWith(
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
      payouts.writePayout.mockRejectedValue(new Error('PAYOUT_EXCEEDS_CASH'));
      await expect(service.create(oksana, dto({ paid_amount: '380.00' }) as never)).rejects.toThrow(
        'PAYOUT_EXCEEDS_CASH',
      );
      // The mock `transaction` just runs the callback; the real one rolls back
      // on a throw. What this asserts is that the throw is not swallowed.
    });
  });

  /**
   * `POST /intakes/preview` — `create` up to the point where it would write,
   * and then nothing. The reception screen shows net weight, price, bonus and
   * the line and document amounts LIVE as the operator types, and §2.4/§2.8/
   * §2.9 make the server the only place those may be computed — so the client
   * asks for the numbers without asking for a document.
   */
  describe('preview', () => {
    const previewDto = (over: Record<string, unknown> = {}) => ({
      supplier_id: SUPPLIER,
      items: dto().items,
      ...over,
    });

    it('computes exactly what create would store — lines, total, point, supplier, business date', async () => {
      const result = await service.preview(oksana, previewDto());

      expect(result).toEqual({
        collection_point_id: POINT_A,
        supplier_id: SUPPLIER,
        business_date: '2026-09-08',
        amount: '2103.30',
        items: [
          {
            item_order: 1,
            product_grade_id: GRADE,
            gross_kg: '42.00',
            pallet_kg: '1.50',
            tare_weight_kg: '3.60',
            net_kg: '36.90',
            price: '57.00',
            bonus: '0.00',
            amount: '2103.30',
            tare: [{ tare_type_id: CRATE, units: 3 }],
          },
        ],
      });
    });

    it('writes NOTHING — no transaction, no save, no audit, no code', async () => {
      const result = await service.preview(oksana, previewDto());

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('id');
      expect(result).not.toHaveProperty('code');
      expect(result.items[0]).not.toHaveProperty('id');
    });

    it('takes the SAME snapshots create takes, through the plain manager', async () => {
      // Same reads, same order, so the preview and the document that follows
      // it can only disagree if a price or tare row changed in between.
      await service.preview(oksana, previewDto());

      expect(shifts.findOpenAtPoint).toHaveBeenCalledWith(POINT_A, plainManager);
      expect(prices.currentFor).toHaveBeenCalledWith(POINT_A, GRADE, plainManager);
      expect(tare.findManyRaw).toHaveBeenCalledWith([CRATE], plainManager);
    });

    it('409s when no shift is open — the form is unusable outside one, and the operator learns it early', async () => {
      shifts.findOpenAtPoint.mockResolvedValue(null);

      await expect(service.preview(oksana, previewDto())).rejects.toMatchObject({
        response: { code: 'NO_OPEN_SHIFT' },
      });
    });

    it('refuses the same supplier create refuses: inactive, or at another point', async () => {
      suppliers.findOne.mockResolvedValueOnce({
        id: SUPPLIER,
        collection_point_id: POINT_A,
        is_active: false,
      });
      await expect(service.preview(oksana, previewDto())).rejects.toMatchObject({
        response: { code: 'SUPPLIER_INACTIVE' },
      });

      suppliers.findOne.mockResolvedValueOnce({
        id: SUPPLIER,
        collection_point_id: POINT_B,
        is_active: true,
      });
      await expect(service.preview(oksana, previewDto())).rejects.toThrow(NotFoundException);
    });

    it('400s a grade with no current price at this point (§4.5)', async () => {
      prices.currentFor.mockResolvedValue(null);

      await expect(service.preview(oksana, previewDto())).rejects.toMatchObject({
        response: { code: 'GRADE_NOT_PRICED' },
      });
    });

    it('400s a tare type it cannot snapshot — unknown or deactivated', async () => {
      tare.findManyRaw.mockResolvedValue([]);

      await expect(service.preview(oksana, previewDto())).rejects.toMatchObject({
        response: { code: 'TARE_TYPE_UNKNOWN' },
      });
    });

    it('resolves the point the way create does: token for an operator, body for the owner', async () => {
      await expect(service.preview(owner, previewDto())).rejects.toMatchObject({
        response: { code: 'COLLECTION_POINT_REQUIRED' },
      });

      const result = await service.preview(owner, previewDto({ collection_point_id: POINT_A }));
      expect(result.collection_point_id).toBe(POINT_A);

      points.findOneRaw.mockResolvedValue(null);
      await expect(
        service.preview(owner, previewDto({ collection_point_id: POINT_B })),
      ).rejects.toThrow(NotFoundException);
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

  /**
   * §11.5 — the journal every row of which now carries the four columns
   * `intake-row-extras.ts` defines ONCE. `getRawAndEntities` is the seam:
   * TypeORM keeps `raw[n]` aligned with `entities[n]` for a to-one join, so
   * the mock's single row proves the wiring — the alignment claim itself is
   * proven against real Postgres by the Task 6 db-spec, not here.
   */
  describe('list', () => {
    let qb: {
      innerJoinAndMapOne: jest.Mock;
      innerJoin: jest.Mock;
      addSelect: jest.Mock;
      andWhere: jest.Mock;
      orderBy: jest.Mock;
      addOrderBy: jest.Mock;
      skip: jest.Mock;
      take: jest.Mock;
      getRawAndEntities: jest.Mock;
      getCount: jest.Mock;
      clone: jest.Mock;
    };

    const listQuery = (over: Record<string, unknown> = {}) => ({
      page: 1,
      limit: 20,
      include_voided: true,
      ...over,
    });

    beforeEach(() => {
      qb = {
        innerJoinAndMapOne: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getRawAndEntities: jest.fn().mockResolvedValue({
          entities: [{ ...intake(), shift: shift() }],
          raw: [
            {
              i_id: INTAKE_ID,
              net_kg: '36.90',
              lines_count: 2,
              supplier_name: 'Іван Коваль',
              paid_amount: '0.00',
            },
          ],
        }),
        getCount: jest.fn().mockResolvedValue(1),
        // `clone()` returns THIS SAME mock object by default (`qb.clone()`
        // called as a method binds `this` to `qb`), so its `getCount` is the
        // one already stocked above — the dedicated clone test below
        // overrides this to prove the real builder is never asked for a
        // count directly.
        clone: jest.fn().mockReturnThis(),
      };
      repo.createQueryBuilder.mockReturnValue(qb);
    });

    it('carries net_kg, lines_count, supplier_name and paid_amount on every row', async () => {
      const result = await service.list(oksana, listQuery() as never);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        net_kg: '36.90',
        lines_count: 2,
        supplier_name: 'Іван Коваль',
        paid_amount: '0.00',
      });
      expect(result.total).toBe(1);
    });

    it('joins suppliers and adds the four extras selects, once each', async () => {
      await service.list(oksana, listQuery() as never);

      expect(qb.innerJoin).toHaveBeenCalledWith(expect.anything(), 'sup', 'sup.id = i.supplier_id');
      expect(qb.addSelect).toHaveBeenCalledTimes(4);
    });

    it('maps each raw row to its OWN entity BY ID, not by array position', async () => {
      // Two intakes with different extras, and the raw rows handed back in
      // the OPPOSITE order from the entities — a positional `raw[n]` read
      // would hand intake TWO's numbers to intake ONE's row (or vice versa)
      // and this test would not notice unless the values actually differ.
      const OTHER_ID = '99999999-9999-9999-9999-999999999999';
      qb.getRawAndEntities.mockResolvedValue({
        entities: [
          { ...intake({ id: INTAKE_ID }), shift: shift() },
          { ...intake({ id: OTHER_ID }), shift: shift() },
        ],
        raw: [
          {
            i_id: OTHER_ID,
            net_kg: '5.00',
            lines_count: 1,
            supplier_name: 'Петро Мельник',
            paid_amount: '100.00',
          },
          {
            i_id: INTAKE_ID,
            net_kg: '36.90',
            lines_count: 2,
            supplier_name: 'Іван Коваль',
            paid_amount: '0.00',
          },
        ],
      });
      qb.getCount.mockResolvedValue(2);

      const result = await service.list(oksana, listQuery() as never);

      expect(result.data).toHaveLength(2);
      expect(result.data.find((r) => r.id === INTAKE_ID)).toMatchObject({
        net_kg: '36.90',
        lines_count: 2,
        supplier_name: 'Іван Коваль',
        paid_amount: '0.00',
      });
      expect(result.data.find((r) => r.id === OTHER_ID)).toMatchObject({
        net_kg: '5.00',
        lines_count: 1,
        supplier_name: 'Петро Мельник',
        paid_amount: '100.00',
      });
    });

    it('runs the count on a CLONE of the builder, not the builder itself', async () => {
      // `getCount()` flips `expressionMap.queryEntity` on the builder it
      // runs on; sharing one builder between the two in-flight calls would
      // make them fight over that map.
      const clone = { getCount: jest.fn().mockResolvedValue(1) };
      qb.clone = jest.fn().mockReturnValue(clone);

      await service.list(oksana, listQuery() as never);

      expect(qb.clone).toHaveBeenCalled();
      expect(clone.getCount).toHaveBeenCalled();
    });

    it('throws a programming error, not a 400, when a raw row is missing for an entity', async () => {
      qb.getRawAndEntities.mockResolvedValue({
        entities: [{ ...intake(), shift: shift() }],
        raw: [],
      });

      await expect(service.list(oksana, listQuery() as never)).rejects.toThrow(
        `intake row extras missing for ${INTAKE_ID}`,
      );
    });
  });

  describe('findOne', () => {
    beforeEach(() => {
      repo.findOne.mockResolvedValue(intake());
      shifts.findOneRaw.mockResolvedValue(shift());
    });

    it('404s when the intake does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.findOne(oksana, INTAKE_ID)).rejects.toThrow(NotFoundException);
    });

    it('404s an intake at another point for an operator', async () => {
      await expect(service.findOne(elsewhere, INTAKE_ID)).rejects.toThrow(NotFoundException);
    });

    it('carries the four row extras alongside the items and payouts', async () => {
      const result = await service.findOne(oksana, INTAKE_ID);

      expect(result.net_kg).toBe('36.90');
      expect(result.lines_count).toBe(2);
      expect(result.supplier_name).toBe('Іван Коваль');
      expect(result.paid_amount).toBe('0.00');
    });

    it('names the receiver on the detail', async () => {
      const result = await service.findOne(oksana, INTAKE_ID);

      expect(result.received_by_name).toBe('Оксана Гнатюк');
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
