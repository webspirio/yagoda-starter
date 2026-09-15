import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CratesService } from './crates.service';
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

  let repo: { findOne: jest.Mock };
  let manager: { query: jest.Mock; save: jest.Mock; create: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let shifts: { findOpenAtPoint: jest.Mock };
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

  beforeEach(() => {
    manager = {
      query: jest.fn().mockResolvedValue([{ n: 0 }]),
      save: jest.fn().mockImplementation((_e, v) => Promise.resolve(issuance(v))),
      create: jest.fn().mockImplementation((_e, v) => v),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)),
    };
    repo = { findOne: jest.fn().mockResolvedValue(null) };
    shifts = { findOpenAtPoint: jest.fn().mockResolvedValue(shift()) };
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
      repo as never,
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
});
