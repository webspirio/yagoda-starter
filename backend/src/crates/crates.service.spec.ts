import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CratesService } from './crates.service';
import { CrateReturn } from './crate-return.entity';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { UserRole } from '../users/user-role.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const SHIFT_ID = '33333333-3333-3333-3333-333333333333';
const SUPPLIER = '44444444-4444-4444-4444-444444444444';

describe('CratesService', () => {
  const operator = {
    sub: 'op-1',
    role: UserRole.PointOperator,
    collection_point_id: POINT_A,
  } as never;

  let manager: {
    query: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let shifts: { findOpenAtPoint: jest.Mock; findOneRaw: jest.Mock };
  let suppliers: { findOne: jest.Mock };
  let points: { findOneRaw: jest.Mock };
  let tareTypes: { findCrateType: jest.Mock };
  let audit: { record: jest.Mock };
  let balance: { tranchesFor: jest.Mock; balanceFor: jest.Mock; pointDepositBook: jest.Mock };
  let service: CratesService;

  const shift = (over: Record<string, unknown> = {}) => ({
    id: SHIFT_ID,
    collection_point_id: POINT_A,
    business_date: '2026-09-15',
    closed_at: null,
    ...over,
  });

  const issuance = (over: Record<string, unknown> = {}) => ({
    id: 'issuance-1',
    code: 'KPG-CD-20260915-001',
    shift_id: SHIFT_ID,
    supplier_id: SUPPLIER,
    units: 20,
    mode: CrateIssuanceMode.Deposit,
    deposit_per_unit: '0.00',
    deposit_taken: '0.00',
    issued_by_user_id: 'op-1',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: new Date('2026-09-15T07:00:00.000Z'),
    updated_at: new Date('2026-09-15T07:00:00.000Z'),
    ...over,
  });

  const crateReturn = (over: Record<string, unknown> = {}) => ({
    id: 'return-1',
    shift_id: SHIFT_ID,
    supplier_id: SUPPLIER,
    intake_id: null,
    units: 10,
    deposit_refund: '1200.00',
    accepted_by_user_id: 'op-1',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    created_at: new Date('2026-09-15T07:00:00.000Z'),
    updated_at: new Date('2026-09-15T07:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    manager = {
      query: jest.fn().mockResolvedValue([{ n: 0 }]),
      save: jest
        .fn()
        .mockImplementation((entity, v) =>
          Promise.resolve(entity === CrateReturn ? crateReturn(v) : issuance(v)),
        ),
      create: jest.fn().mockImplementation((_e, v) => v),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
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
    points = { findOneRaw: jest.fn().mockResolvedValue({ id: POINT_A, code: 'KPG' }) };
    tareTypes = {
      findCrateType: jest.fn().mockResolvedValue({ id: 't-1', deposit_price: '120.00' }),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    balance = {
      tranchesFor: jest.fn().mockResolvedValue([]),
      balanceFor: jest.fn(),
      pointDepositBook: jest.fn().mockResolvedValue('999999.00'),
    };

    service = new CratesService(
      dataSource as never,
      shifts as never,
      suppliers as never,
      points as never,
      tareTypes as never,
      audit as never,
      balance as never,
    );
  });

  describe('issue', () => {
  it('refuses when the point has no open shift', async () => {
    shifts.findOpenAtPoint.mockResolvedValue(null);

    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit }),
    ).rejects.toMatchObject({ response: { code: 'NO_OPEN_SHIFT' } });
  });

  it('refuses a supplier belonging to another point, as a 404', async () => {
    suppliers.findOne.mockResolvedValue({ id: 's-1', collection_point_id: 'point-2', is_active: true });

    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses when no crate type is configured', async () => {
    tareTypes.findCrateType.mockResolvedValue(null);

    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit }),
    ).rejects.toMatchObject({ response: { code: 'NO_CRATE_TYPE' } });
  });

  it('snapshots the catalogue price and computes the deposit', async () => {
    tareTypes.findCrateType.mockResolvedValue({ id: 't-1', deposit_price: '120.00' });

    await service.issue(operator, {
      supplier_id: 's-1',
      units: 20,
      mode: CrateIssuanceMode.Deposit,
    });

    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deposit_per_unit: '120.00', deposit_taken: '2400.00', units: 20 }),
    );
  });

  /** §6.4 — «за розписку грошей немає взагалі». */
  it('writes zeros for a receipt issuance whatever the catalogue says', async () => {
    tareTypes.findCrateType.mockResolvedValue({ id: 't-1', deposit_price: '120.00' });

    await service.issue(operator, {
      supplier_id: 's-1',
      units: 200,
      mode: CrateIssuanceMode.Receipt,
    });

    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deposit_per_unit: '0.00', deposit_taken: '0.00' }),
    );
  });

  it('does not enforce §6.2 threshold in either direction', async () => {
    tareTypes.findCrateType.mockResolvedValue({ id: 't-1', deposit_price: '120.00' });

    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 200, mode: CrateIssuanceMode.Deposit }),
    ).resolves.toBeDefined();
    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 5, mode: CrateIssuanceMode.Receipt }),
    ).resolves.toBeDefined();
  });

  it('refuses a deactivated supplier', async () => {
    suppliers.findOne.mockResolvedValue({ id: 's-1', collection_point_id: POINT_A, is_active: false });

    await expect(
      service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('audits crate-issuance.created', async () => {
    await service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'crate-issuance.created' }),
      manager,
    );
  });

  it('generates the code inside the transaction, via the crate-code seam', async () => {
    await service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit });

    // nextIssuanceCode issues a COUNT(*) query against crate_issuances.
    expect(manager.query).toHaveBeenCalled();
  });

  it('signs the document with who pressed the button', async () => {
    await service.issue(operator, { supplier_id: 's-1', units: 20, mode: CrateIssuanceMode.Deposit });

    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ issued_by_user_id: 'op-1' }),
    );
  });
  });

  describe('returnCrates', () => {
    const tranches = [
      {
        issuance_id: 'jul18',
        code: 'KPG-CD-20260718-001',
        remaining_units: 20,
        per_unit: '120.00',
        mode: CrateIssuanceMode.Deposit,
      },
      {
        issuance_id: 'jul28',
        code: 'KPG-CD-20260728-001',
        remaining_units: 20,
        per_unit: '130.00',
        mode: CrateIssuanceMode.Deposit,
      },
    ];

    /**
     * Proves ORDERING, not just presence. `balance.tranchesFor` is a plain
     * mock — it never touches `manager.query` on its own — so a bare
     * "`manager.query` contains FOR UPDATE somewhere" assertion would stay
     * green even if the read ran on a different connection outside the lock,
     * which is exactly the double-refund race the lock exists to prevent.
     * `invocationCallOrder` is what actually pins the lock BEFORE the read,
     * and the `toHaveBeenCalledWith(..., manager)` pair is what pins the read
     * and the book check to the SAME transaction as the lock.
     */
    it('locks the supplier row before reading tranches, on the same connection', async () => {
      balance.tranchesFor.mockResolvedValue(tranches);

      await service.returnCrates(operator, { supplier_id: 's-1', units: 7 });

      const [firstSql, firstParams] = manager.query.mock.calls[0] as [string, unknown[]];
      expect(firstSql).toContain('FOR UPDATE');
      expect(firstParams).toEqual(['s-1']);

      expect(balance.tranchesFor).toHaveBeenCalledWith('s-1', manager);
      expect(balance.pointDepositBook).toHaveBeenCalledWith(POINT_A, manager);
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        balance.tranchesFor.mock.invocationCallOrder[0],
      );
    });

    it('writes the CrateReturn header with the frozen refund', async () => {
      balance.tranchesFor.mockResolvedValue(tranches);

      await service.returnCrates(operator, { supplier_id: 's-1', units: 7 });

      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ units: 7, deposit_refund: '840.00' }),
      );
    });

    /**
     * Deleting the allocator's write loop entirely (see `CratesService
     * .returnCrates`'s `for (const row of result.allocations)`) would still
     * pass the header assertion above — `remaining_units` would just never
     * decrease, and a supplier could return the same crates forever. This
     * test is what actually fails if that loop goes missing: it asserts the
     * ALLOCATION row itself, by value.
     */
    it('writes an allocation row for the tranche it drew from', async () => {
      balance.tranchesFor.mockResolvedValue(tranches);

      await service.returnCrates(operator, { supplier_id: 's-1', units: 7 });

      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          issuance_id: 'jul18',
          units: 7,
          per_unit: '120.00',
          amount: '840.00',
        }),
      );
    });

    /**
     * A request spanning two tranches must write TWO allocation rows, each at
     * ITS OWN tranche's price — proof that this service wires the allocator's
     * output through, value for value, rather than e.g. writing one row at a
     * blended or catalogue price. `crate-allocation.spec.ts` already proves
     * the allocator's own split; this proves the service doesn't lose it.
     */
    it('writes one allocation row per tranche consumed, each at its own price', async () => {
      balance.tranchesFor.mockResolvedValue(tranches);

      await service.returnCrates(operator, { supplier_id: 's-1', units: 25 });

      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          issuance_id: 'jul18',
          units: 20,
          per_unit: '120.00',
          amount: '2400.00',
        }),
      );
      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          issuance_id: 'jul28',
          units: 5,
          per_unit: '130.00',
          amount: '650.00',
        }),
      );
    });

    /** §6.5 — «повернути більше, ніж узято, не можна… помилка вводу, а не подія». */
    it('refuses to return more than is outstanding, naming the number', async () => {
      balance.tranchesFor.mockResolvedValue([tranches[0]]);

      await expect(
        service.returnCrates(operator, { supplier_id: 's-1', units: 25 }),
      ).rejects.toMatchObject({ response: { code: 'RETURN_EXCEEDS_OUTSTANDING' } });
    });

    it('refuses when the point has no open shift', async () => {
      shifts.findOpenAtPoint.mockResolvedValue(null);

      await expect(
        service.returnCrates(operator, { supplier_id: 's-1', units: 5 }),
      ).rejects.toMatchObject({ response: { code: 'NO_OPEN_SHIFT' } });
    });

    /**
     * §6.7's assertion. It cannot fire under valid documents — FIFO guarantees a
     * refund never exceeds what that supplier deposited — so this test drives an
     * IMPOSSIBLE state deliberately to prove the guard is wired, not decorative.
     */
    it('refuses when the crates book would go negative', async () => {
      balance.tranchesFor.mockResolvedValue(tranches);
      balance.pointDepositBook.mockResolvedValue('100.00');

      await expect(
        service.returnCrates(operator, { supplier_id: 's-1', units: 7 }),
      ).rejects.toMatchObject({ response: { code: 'CRATE_CASH_INSUFFICIENT' } });
    });

    /** R2 — `returnCrates` is now `writeReturn` plus a caller that always
     *  passes `intakeId: null`; this is the one place that fixes what "always"
     *  means. */
    it('writes intake_id: null — the standalone route never links a receipt', async () => {
      balance.tranchesFor.mockResolvedValue(tranches);

      await service.returnCrates(operator, { supplier_id: 's-1', units: 7 });

      expect(manager.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ intake_id: null }),
      );
    });
  });

  /**
   * R2 — the extracted writer, exercised directly the way `IntakesService`
   * (Task R3) will call it: with an already-resolved shift and a real
   * `intakeId`, inside a transaction the caller opened.
   */
  describe('writeReturn', () => {
    const tranches = [
      {
        issuance_id: 'jul18',
        code: 'KPG-CD-20260718-001',
        remaining_units: 20,
        per_unit: '120.00',
        mode: CrateIssuanceMode.Deposit,
      },
    ];
    const openShift = shift();

    it('carries a caller-supplied intake_id onto the return and its audit entry', async () => {
      balance.tranchesFor.mockResolvedValue(tranches);

      const result = await service.writeReturn(manager as never, {
        actor: operator,
        pointId: POINT_A,
        shift: openShift as never,
        supplierId: SUPPLIER,
        units: 5,
        intakeId: 'intake-42',
      });

      expect(result.ret.intake_id).toBe('intake-42');
      expect(manager.create).toHaveBeenCalledWith(
        CrateReturn,
        expect.objectContaining({ intake_id: 'intake-42', units: 5 }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'crate-return.created',
          after: expect.objectContaining({ intake_id: 'intake-42' }),
        }),
        manager,
      );
    });

    it('locks the supplier row itself, idempotently, when called directly', async () => {
      balance.tranchesFor.mockResolvedValue(tranches);

      await service.writeReturn(manager as never, {
        actor: operator,
        pointId: POINT_A,
        shift: openShift as never,
        supplierId: SUPPLIER,
        units: 5,
        intakeId: null,
      });

      const [firstSql, firstParams] = manager.query.mock.calls[0] as [string, unknown[]];
      expect(firstSql).toContain('FOR UPDATE');
      expect(firstParams).toEqual([SUPPLIER]);
    });

    it('still refuses RETURN_EXCEEDS_OUTSTANDING for a linked call', async () => {
      balance.tranchesFor.mockResolvedValue([tranches[0]]);

      await expect(
        service.writeReturn(manager as never, {
          actor: operator,
          pointId: POINT_A,
          shift: openShift as never,
          supplierId: SUPPLIER,
          units: 25,
          intakeId: 'intake-42',
        }),
      ).rejects.toMatchObject({ response: { code: 'RETURN_EXCEEDS_OUTSTANDING' } });
    });
  });

  describe('previewReturn', () => {
    const mixedTranches = [
      {
        issuance_id: 'a',
        code: 'KPG-CD-20260701-001',
        remaining_units: 20,
        per_unit: '120.00',
        mode: CrateIssuanceMode.Deposit,
      },
      {
        issuance_id: 'b',
        code: 'KPG-CR-20260702-001',
        remaining_units: 30,
        per_unit: '0.00',
        mode: CrateIssuanceMode.Receipt,
      },
    ];

    it('returns the split without writing anything', async () => {
      balance.tranchesFor.mockResolvedValue(mixedTranches);

      const preview = await service.previewReturn(operator, { supplier_id: 's-1', units: 45 });

      expect(preview.deposit_refund).toBe('2400.00');
      expect(preview.allocations).toHaveLength(2);
      expect(manager.save).not.toHaveBeenCalled();
    });

    /**
     * The RULING for this round: the preview is the screen the operator reads
     * BEFORE committing, so «25 за розпискою, без грошей» matters more here
     * than on the receipt afterwards — the preview must carry the same
     * mode/code split the written document does, not a bare total.
     */
    it('carries mode on each row, so a receipt-mode tranche shows no money', async () => {
      balance.tranchesFor.mockResolvedValue(mixedTranches);

      const preview = await service.previewReturn(operator, { supplier_id: 's-1', units: 45 });

      expect(preview.allocations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            issuance_id: 'b',
            mode: CrateIssuanceMode.Receipt,
            amount: '0.00',
          }),
        ]),
      );
    });

    /**
     * The shortfall contract, pinned. The client must inspect `shortfall`
     * before rendering a refund the create call would refuse with
     * `RETURN_EXCEEDS_OUTSTANDING` — nothing in this suite tested that the
     * preview reports it as data rather than throwing.
     */
    it('reports a shortfall as data, not a thrown error', async () => {
      balance.tranchesFor.mockResolvedValue(mixedTranches);

      const preview = await service.previewReturn(operator, { supplier_id: 's-1', units: 55 });

      expect(preview.shortfall).toBe(5);
      expect(preview.deposit_refund).toBe('2400.00');
    });
  });

  describe('voids', () => {
    // Named distinctly from the file-level `operator` fixture (not
    // `owner`/`operator`) so a future test added in this block that reaches
    // for the outer fixture gets a compile error, not a silently wrong actor.
    // Point id 'point-1' matches the shift overrides used throughout this
    // block ('point-1' the void-operator's own, 'point-2'/'point-9'
    // someone else's).
    const voidOperator = {
      sub: 'op-1',
      role: UserRole.PointOperator,
      collection_point_id: 'point-1',
    } as never;
    const voidOwner = {
      sub: 'owner-1',
      role: UserRole.NetworkOwner,
      collection_point_id: null,
    } as never;

    const loadIssuance = (over: Record<string, unknown> = {}) => {
      const { shift: shiftOver, ...rest } = over;
      manager.findOne.mockResolvedValue(issuance(rest));
      shifts.findOneRaw.mockResolvedValue(shift(shiftOver as Record<string, unknown> | undefined));
    };

    const loadReturn = (over: Record<string, unknown> = {}) => {
      const { shift: shiftOver, ...rest } = over;
      manager.findOne.mockResolvedValue(crateReturn(rest));
      shifts.findOneRaw.mockResolvedValue(shift(shiftOver as Record<string, unknown> | undefined));
    };

    /**
     * The fix-round finding: a void that locks only the document leaves the
     * supplier row uncontended, so a concurrent `returnCrates` can lock the
     * supplier, read `tranchesFor` on a snapshot where this issuance still
     * looks live, and allocate against it before this void commits — a live
     * allocation against a voided issuance. `returnCrates` locks the
     * supplier BEFORE its document work, so the fix has to take the SAME
     * lock, in the SAME order, before its own document load — otherwise the
     * two acquire their two locks in opposite orders and can deadlock
     * instead of one simply waiting for the other. `invocationCallOrder` is
     * what actually proves the ORDER, not merely that both locks were taken
     * — a count-only assertion would pass code that takes them in the wrong
     * sequence.
     */
    it('locks the supplier row before loading the issuance for write', async () => {
      loadIssuance({ shift: { collection_point_id: 'point-1', closed_at: null } });

      await service.voidIssuance(voidOperator, 'i-1', { reason: 'x' });

      const forUpdateCallIndex = (manager.query.mock.calls as [string, unknown[]][]).findIndex(
        ([sql]) => sql.includes('FOR UPDATE'),
      );
      expect(forUpdateCallIndex).toBeGreaterThanOrEqual(0);
      expect(manager.query.mock.calls[forUpdateCallIndex][1]).toEqual([SUPPLIER]);

      const forUpdateOrder = manager.query.mock.invocationCallOrder[forUpdateCallIndex];
      const [stubLoadOrder, lockedLoadOrder] = manager.findOne.mock.invocationCallOrder;
      expect(stubLoadOrder).toBeLessThan(forUpdateOrder);
      expect(forUpdateOrder).toBeLessThan(lockedLoadOrder);
    });

    it('locks the supplier row before loading the return for write', async () => {
      loadReturn({ shift: { collection_point_id: 'point-1', closed_at: null } });

      await service.voidReturn(voidOperator, 'r-1', { reason: 'x' });

      const forUpdateCallIndex = (manager.query.mock.calls as [string, unknown[]][]).findIndex(
        ([sql]) => sql.includes('FOR UPDATE'),
      );
      expect(forUpdateCallIndex).toBeGreaterThanOrEqual(0);
      expect(manager.query.mock.calls[forUpdateCallIndex][1]).toEqual([SUPPLIER]);

      const forUpdateOrder = manager.query.mock.invocationCallOrder[forUpdateCallIndex];
      const [stubLoadOrder, lockedLoadOrder] = manager.findOne.mock.invocationCallOrder;
      expect(stubLoadOrder).toBeLessThan(forUpdateOrder);
      expect(forUpdateOrder).toBeLessThan(lockedLoadOrder);
    });

    it('lets an operator void a COLLEAGUE’s document at their own point', async () => {
      loadIssuance({ issued_by_user_id: 'someone-else', shift: { collection_point_id: 'point-1', closed_at: null } });

      await expect(
        service.voidIssuance(voidOperator, 'i-1', { reason: 'помилка вводу' }),
      ).resolves.toBeDefined();
    });

    it('refuses an operator voiding a CLOSED shift’s document', async () => {
      loadIssuance({ shift: { collection_point_id: 'point-1', closed_at: new Date() } });

      await expect(
        service.voidIssuance(voidOperator, 'i-1', { reason: 'помилка' }),
      ).rejects.toMatchObject({ response: { code: 'SHIFT_CLOSED' } });
    });

    it('lets the owner void a closed shift’s document', async () => {
      loadIssuance({ shift: { collection_point_id: 'point-9', closed_at: new Date() } });

      await expect(
        service.voidIssuance(voidOwner, 'i-1', { reason: 'перевірка' }),
      ).resolves.toBeDefined();
    });

    it('404s a document at another point for an operator', async () => {
      loadIssuance({ shift: { collection_point_id: 'point-2', closed_at: null } });

      await expect(
        service.voidIssuance(voidOperator, 'i-1', { reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    /** §9.3 — «видачу, на яку вже лягло повернення, сторнувати не можна». */
    it('refuses to void an issuance that has live allocations', async () => {
      loadIssuance({ shift: { collection_point_id: 'point-1', closed_at: null } });
      manager.query.mockImplementation((sql: string) =>
        sql.includes('crate_return_allocations') ? Promise.resolve([{ n: 1 }]) : Promise.resolve([]),
      );

      await expect(
        service.voidIssuance(voidOperator, 'i-1', { reason: 'x' }),
      ).rejects.toMatchObject({ response: { code: 'ISSUANCE_HAS_RETURNS' } });
    });

    it('refuses to void an already-voided document', async () => {
      loadIssuance({ voided_at: new Date(), shift: { collection_point_id: 'point-1', closed_at: null } });

      await expect(
        service.voidIssuance(voidOperator, 'i-1', { reason: 'x' }),
      ).rejects.toMatchObject({ response: { code: 'ALREADY_VOIDED' } });
    });

    it('voiding a return does not delete its allocations', async () => {
      loadReturn({ shift: { collection_point_id: 'point-1', closed_at: null } });

      await service.voidReturn(voidOperator, 'r-1', { reason: 'перерахували' });

      const deletes = (manager.query.mock.calls as [string][]).filter(([sql]) =>
        sql.includes('DELETE'),
      );
      expect(deletes).toHaveLength(0);
      expect(manager.delete).not.toHaveBeenCalled();
    });

    // Additional authority-matrix cases the brief's list did not spell out.

    it('refuses a closed shift for an operator on a RETURN too, not just an issuance', async () => {
      loadReturn({ shift: { collection_point_id: 'point-1', closed_at: new Date() } });

      await expect(
        service.voidReturn(voidOperator, 'r-1', { reason: 'x' }),
      ).rejects.toMatchObject({ response: { code: 'SHIFT_CLOSED' } });
    });

    it('404s a return at another point for an operator', async () => {
      loadReturn({ shift: { collection_point_id: 'point-2', closed_at: null } });

      await expect(
        service.voidReturn(voidOperator, 'r-1', { reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to void an already-voided return', async () => {
      loadReturn({ voided_at: new Date(), shift: { collection_point_id: 'point-1', closed_at: null } });

      await expect(
        service.voidReturn(voidOperator, 'r-1', { reason: 'x' }),
      ).rejects.toMatchObject({ response: { code: 'ALREADY_VOIDED' } });
    });

    it('lets the owner void an issuance at ANY point, open or closed', async () => {
      loadIssuance({ shift: { collection_point_id: 'point-2', closed_at: null } });

      await expect(
        service.voidIssuance(voidOwner, 'i-1', { reason: 'перевірка' }),
      ).resolves.toBeDefined();
    });

    /**
     * Fix-round finding: `voidReturn` now calls the SAME shared
     * `assertMayVoid` `voidIssuance` does, but nothing previously exercised
     * the owner path on a return at all. A copy/paste slip in either verb's
     * wiring to that shared check would have gone undetected.
     */
    it('lets the owner void a return, at their own point, shift open or closed', async () => {
      loadReturn({ shift: { collection_point_id: 'point-1', closed_at: new Date() } });

      await expect(
        service.voidReturn(voidOwner, 'r-1', { reason: 'перевірка' }),
      ).resolves.toBeDefined();
    });

    /** The case that would actually catch an inverted point-check on the
     *  return path: the owner voiding a return at a point that is NOT
     *  theirs must still succeed — owner authority is point-independent. */
    it('lets the owner void a return at a point that is not theirs', async () => {
      loadReturn({ shift: { collection_point_id: 'point-9', closed_at: null } });

      await expect(
        service.voidReturn(voidOwner, 'r-1', { reason: 'перевірка' }),
      ).resolves.toBeDefined();
    });

    it('lets an operator void an issuance with no live allocations, at an open shift', async () => {
      loadIssuance({ shift: { collection_point_id: 'point-1', closed_at: null } });

      await expect(
        service.voidIssuance(voidOperator, 'i-1', { reason: 'x' }),
      ).resolves.toBeDefined();
    });

    /**
     * Fix-round finding: the prior version of this test asserted only two of
     * the three void columns. `CHK_crate_issuances_void_trio` fails the
     * database unless all three are non-null together, so a two-field write
     * would 500 in production while a test checking only two fields stayed
     * green. Assert all three, and assert the ACTOR's id, not the original
     * author's.
     */
    it('writes the full void trio, signed by the actor who pressed the button — not the original author', async () => {
      loadIssuance({
        issued_by_user_id: 'someone-else',
        shift: { collection_point_id: 'point-1', closed_at: null },
      });

      await service.voidIssuance(voidOperator, 'i-1', { reason: 'помилка вводу' });

      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          voided_at: expect.any(Date),
          voided_by_user_id: 'op-1',
          void_reason: 'помилка вводу',
        }),
      );
    });

    /** Same trio proof, on the return path — nothing previously inspected
     *  `manager.save`'s argument for `voidReturn` at all. */
    it('writes the full void trio on a return, signed by the actor', async () => {
      loadReturn({
        accepted_by_user_id: 'someone-else',
        shift: { collection_point_id: 'point-1', closed_at: null },
      });

      await service.voidReturn(voidOperator, 'r-1', { reason: 'перерахували' });

      expect(manager.save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          voided_at: expect.any(Date),
          voided_by_user_id: 'op-1',
          void_reason: 'перерахували',
        }),
      );
    });

    it('audits crate-issuance.voided', async () => {
      loadIssuance({ shift: { collection_point_id: 'point-1', closed_at: null } });

      await service.voidIssuance(voidOperator, 'i-1', { reason: 'x' });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'crate-issuance.voided' }),
        manager,
      );
    });

    it('audits crate-return.voided', async () => {
      loadReturn({ shift: { collection_point_id: 'point-1', closed_at: null } });

      await service.voidReturn(voidOperator, 'r-1', { reason: 'x' });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'crate-return.voided' }),
        manager,
      );
    });

    /** R2 — spec §8.3: a return a receipt wrote is voided only as part of
     *  voiding that receipt, never on its own. */
    it('refuses a standalone void of a return a receipt wrote, naming the receipt', async () => {
      loadReturn({
        intake_id: 'intake-9',
        shift: { collection_point_id: 'point-1', closed_at: null },
      });
      manager.query.mockImplementation((sql: string) =>
        sql.includes('FROM intakes')
          ? Promise.resolve([{ code: 'KPG-IN-20260924-001' }])
          : Promise.resolve([{ id: SUPPLIER }]),
      );

      await expect(
        service.voidReturn(voidOperator, 'r-1', { reason: 'x' }),
      ).rejects.toMatchObject({
        response: {
          code: 'RETURN_BELONGS_TO_INTAKE',
          message: expect.stringContaining('KPG-IN-20260924-001'),
        },
      });
      expect(manager.save).not.toHaveBeenCalled();
    });

    /** The intake check runs AFTER `assertMayVoid` — another point's operator
     *  still 404s first, per the brief's placement note. */
    it('still 404s another point before checking whether the return belongs to an intake', async () => {
      loadReturn({
        intake_id: 'intake-9',
        shift: { collection_point_id: 'point-2', closed_at: null },
      });

      await expect(
        service.voidReturn(voidOperator, 'r-1', { reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  /**
   * R2 — the cascade half of spec §8.3 (no caller yet; Task R3 wires
   * `IntakesService`'s void to call this inside its own transaction).
   */
  describe('voidReturnForIntake', () => {
    const reasonArgs = { actor: operator, intakeId: 'intake-1', reason: 'сторно квитанції' };

    it('voids the live return written by this intake, and audits it', async () => {
      manager.findOne.mockResolvedValue(crateReturn({ intake_id: 'intake-1' }));

      const result = await service.voidReturnForIntake(manager as never, reasonArgs);

      expect(result).not.toBeNull();
      expect(manager.findOne).toHaveBeenCalledWith(
        CrateReturn,
        expect.objectContaining({
          where: expect.objectContaining({ intake_id: 'intake-1' }),
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(manager.save).toHaveBeenCalledWith(
        CrateReturn,
        expect.objectContaining({
          voided_at: expect.any(Date),
          voided_by_user_id: 'op-1',
          void_reason: 'сторно квитанції',
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'crate-return.voided',
          note: 'сторно квитанції',
          after: expect.objectContaining({ intake_id: 'intake-1' }),
        }),
        manager,
      );
    });

    it('returns null when the receipt wrote no return', async () => {
      manager.findOne.mockResolvedValue(null);

      const result = await service.voidReturnForIntake(manager as never, {
        ...reasonArgs,
        intakeId: 'intake-without-a-return',
      });

      expect(result).toBeNull();
      expect(manager.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('takes no supplier lock itself — the caller already holds it', async () => {
      manager.findOne.mockResolvedValue(crateReturn({ intake_id: 'intake-1' }));

      await service.voidReturnForIntake(manager as never, reasonArgs);

      expect(manager.query).not.toHaveBeenCalled();
    });
  });
});
