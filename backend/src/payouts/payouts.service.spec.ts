import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { PayoutsService } from './payouts.service';
import { ShiftStatus } from '../shifts/shift-status.enum';

const POINT_A = '11111111-1111-1111-1111-111111111111';
const POINT_B = '22222222-2222-2222-2222-222222222222';
const SHIFT_ID = '33333333-3333-3333-3333-333333333333';
const SUPPLIER = '44444444-4444-4444-4444-444444444444';
const PAYOUT_ID = '77777777-7777-7777-7777-777777777777';

const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
const oksana = { sub: 'u-oksana', username: 'oksana', role: UserRole.PointOperator, collection_point_id: POINT_A };
const maria = { sub: 'u-maria', username: 'maria', role: UserRole.PointOperator, collection_point_id: POINT_A };
const elsewhere = { sub: 'u-b', username: 'b', role: UserRole.PointOperator, collection_point_id: POINT_B };

describe('PayoutsService', () => {
  let repo: { findOne: jest.Mock; createQueryBuilder: jest.Mock };
  let manager: { query: jest.Mock; save: jest.Mock; create: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let shifts: { findOpenAtPoint: jest.Mock; findOneRaw: jest.Mock };
  let suppliers: { findOne: jest.Mock };
  let balance: { debtFor: jest.Mock };
  let points: { findOneRaw: jest.Mock };
  let audit: { record: jest.Mock };
  let service: PayoutsService;

  const shift = (over: Record<string, unknown> = {}) => ({
    id: SHIFT_ID,
    collection_point_id: POINT_A,
    business_date: '2026-09-08',
    closed_at: null,
    status: ShiftStatus.Open,
    ...over,
  });

  const payout = (over: Record<string, unknown> = {}) => ({
    id: PAYOUT_ID,
    code: 'KPG-PO-20260908-00031',
    shift_id: SHIFT_ID,
    supplier_id: SUPPLIER,
    amount: '1000.00',
    paid_by_user_id: 'u-oksana',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    return_settled_at: null,
    return_settled_by_user_id: null,
    return_note: null,
    created_at: new Date('2026-09-08T07:00:00.000Z'),
    updated_at: new Date('2026-09-08T07:00:00.000Z'),
    ...over,
  });

  const dto = (over: Record<string, unknown> = {}) => ({
    code: '00031',
    supplier_id: SUPPLIER,
    amount: '380.00',
    ...over,
  });

  beforeEach(() => {
    manager = {
      query: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((_e, v) => Promise.resolve(payout(v))),
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
    balance = { debtFor: jest.fn().mockResolvedValue('380.00') };
    points = { findOneRaw: jest.fn().mockResolvedValue({ id: POINT_A, code: 'KPG' }) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    service = new PayoutsService(
      repo as never,
      dataSource as never,
      shifts as never,
      suppliers as never,
      balance as never,
      points as never,
      audit as never,
    );
  });

  const saved = () => manager.save.mock.calls[0][1] as Record<string, unknown>;

  describe('create — the debt half of §3.6', () => {
    it('allows a payout equal to the debt', async () => {
      await expect(service.create(oksana, dto({ amount: '380.00' }))).resolves.toBeDefined();
    });

    it('refuses one kopiyka more', async () => {
      await expect(service.create(oksana, dto({ amount: '380.01' }))).rejects.toMatchObject({
        response: { code: 'PAYOUT_EXCEEDS_DEBT' },
      });
    });

    it('names the current balance in the refusal', async () => {
      // The operator cannot see why 500 was refused unless the message says the
      // balance is 380 — otherwise they retry the same number and are refused
      // again. §3.1 already puts that figure on their screen.
      await expect(service.create(oksana, dto({ amount: '500.00' }))).rejects.toThrow(/380\.00/);
    });

    it('compares NUMERICALLY, not as strings', async () => {
      // '9.99' > '10.00' lexically. A string comparison here would let a payout
      // of 9.99 through against a debt of 10.00 and refuse the reverse.
      balance.debtFor.mockResolvedValue('10.00');

      await expect(service.create(oksana, dto({ amount: '9.99' }))).resolves.toBeDefined();
    });

    it('refuses a zero payout with a 400, not a constraint 500', async () => {
      // Spec §8.6. `CHK_payouts_amount` is the guarantee; without this
      // pre-check the violation reaches the client as an opaque 500, since
      // this backend maps no QueryFailedError. The pipeline spec caught it.
      await expect(service.create(oksana, dto({ amount: '0.00' }))).rejects.toMatchObject({
        response: { code: 'PAYOUT_AMOUNT_ZERO' },
      });
    });

    it('refuses any positive payout against a negative balance', async () => {
      // A negative balance means the network owes nothing. The value is left
      // unclamped by design — «інваріанта борг >= 0 в цій схемі немає».
      balance.debtFor.mockResolvedValue('-120.00');

      await expect(service.create(oksana, dto({ amount: '1.00' }))).rejects.toMatchObject({
        response: { code: 'PAYOUT_EXCEEDS_DEBT' },
      });
    });

    it('locks the supplier row BEFORE reading the debt', async () => {
      await service.create(oksana, dto());

      const first = (manager.query.mock.calls[0] as [string])[0];
      expect(first).toMatch(/FOR UPDATE/);
      // ORDER, not just presence: a lock taken AFTER the debt is read protects
      // nothing. `invocationCallOrder` is the vanilla-Jest way to assert it —
      // `toHaveBeenCalledBefore` is a jest-extended matcher this repo has not
      // installed.
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        balance.debtFor.mock.invocationCallOrder[0],
      );
    });

    it('reads the debt inside the caller’s transaction', async () => {
      // Otherwise the locked value and the checked value are different reads.
      await service.create(oksana, dto());

      expect(balance.debtFor).toHaveBeenCalledWith(SUPPLIER, manager);
    });

    it('composes the code with PO, not IN', async () => {
      await service.create(oksana, dto());

      expect(saved().code).toBe('KPG-PO-20260908-00031');
    });

    it('409s when no shift is open', async () => {
      shifts.findOpenAtPoint.mockResolvedValue(null);

      await expect(service.create(oksana, dto())).rejects.toMatchObject({
        response: { code: 'NO_OPEN_SHIFT' },
      });
    });

    it('404s a supplier at another point', async () => {
      suppliers.findOne.mockResolvedValue({
        id: SUPPLIER,
        collection_point_id: POINT_B,
        is_active: true,
      });

      await expect(service.create(oksana, dto())).rejects.toThrow(NotFoundException);
    });

    it('signs the document with who pressed the button', async () => {
      await service.create(maria, dto());

      expect(saved().paid_by_user_id).toBe('u-maria');
    });

    it('audits payout.created', async () => {
      await service.create(oksana, dto());

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payout.created' }),
        manager,
      );
    });
  });

  describe('void', () => {
    beforeEach(() => {
      repo.findOne.mockResolvedValue(payout());
      shifts.findOneRaw.mockResolvedValue(shift());
    });

    it('follows the same §9.4 authority rule as intakes', async () => {
      await expect(service.void(oksana, PAYOUT_ID, { reason: 'помилка' })).resolves.toBeDefined();
      await expect(service.void(maria, PAYOUT_ID, { reason: 'не моя' })).rejects.toMatchObject({
        response: { code: 'NOT_YOUR_DOCUMENT' },
      });
      await expect(service.void(elsewhere, PAYOUT_ID, { reason: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does NOT touch return_settled_at', async () => {
      // §9.3 — «каса НЕ виросла на 8 000». Voiding and the money coming back
      // are two separate events; conflating them is the theft the rule names.
      await service.void(oksana, PAYOUT_ID, { reason: 'помилка' });

      expect(saved().return_settled_at).toBeNull();
    });

    it('409s an already voided payout', async () => {
      repo.findOne.mockResolvedValue(
        payout({ voided_at: new Date(), voided_by_user_id: 'u-owner', void_reason: 'вже' }),
      );

      await expect(service.void(owner, PAYOUT_ID, { reason: 'ще' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('settleReturn', () => {
    beforeEach(() => {
      repo.findOne.mockResolvedValue(
        payout({ voided_at: new Date(), voided_by_user_id: 'u-oksana', void_reason: 'помилка' }),
      );
      shifts.findOneRaw.mockResolvedValue(shift());
    });

    it('is refused to an operator at their own point', async () => {
      // The operator who voided the payout is the person holding the drawer.
      // Letting them also certify the refill closes §9.3's loop unobserved —
      // «інакше сторно стає способом красти».
      await expect(service.settleReturn(oksana, PAYOUT_ID, {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('409s a payout that is not voided', async () => {
      repo.findOne.mockResolvedValue(payout());

      await expect(service.settleReturn(owner, PAYOUT_ID, {})).rejects.toMatchObject({
        response: { code: 'PAYOUT_NOT_VOIDED' },
      });
    });

    it('409s a payout already settled', async () => {
      repo.findOne.mockResolvedValue(
        payout({
          voided_at: new Date(),
          voided_by_user_id: 'u-oksana',
          void_reason: 'помилка',
          return_settled_at: new Date(),
          return_settled_by_user_id: 'u-owner',
        }),
      );

      await expect(service.settleReturn(owner, PAYOUT_ID, {})).rejects.toMatchObject({
        response: { code: 'RETURN_ALREADY_SETTLED' },
      });
    });

    it('stamps the settler and stores an optional note', async () => {
      await service.settleReturn(owner, PAYOUT_ID, { note: 'вніс готівку 09.09' });

      expect(saved().return_settled_at).toBeInstanceOf(Date);
      expect(saved().return_settled_by_user_id).toBe('u-owner');
      expect(saved().return_note).toBe('вніс готівку 09.09');
    });

    it('does NOT store the amount', async () => {
      // It always equals `payouts.amount`; a second copy is forbidden by the
      // DBML header and would be the number that goes stale.
      await service.settleReturn(owner, PAYOUT_ID, {});

      expect(saved()).not.toHaveProperty('return_amount');
      expect(saved().return_note).toBeNull();
    });
  });
});
