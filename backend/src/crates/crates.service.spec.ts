import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CratesService } from './crates.service';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { UserRole } from '../users/user-role.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const SHIFT_ID = '33333333-3333-3333-3333-333333333333';
const SUPPLIER = '44444444-4444-4444-4444-444444444444';

describe('CratesService.issue', () => {
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

    service = new CratesService(
      repo as never,
      dataSource as never,
      shifts as never,
      suppliers as never,
      points as never,
      tareTypes as never,
      audit as never,
    );
  });

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
