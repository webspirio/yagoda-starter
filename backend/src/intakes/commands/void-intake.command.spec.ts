import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  makeIntakesMocks,
  buildIntakes,
  type IntakesMocks,
  oksana,
  maria,
  owner,
  elsewhere,
  shift,
  intake,
  SHIFT_ID,
  SUPPLIER,
  INTAKE_ID,
} from '../../testing/unit/intakes.mocks';
import { VoidIntakeCommand } from './void-intake.command';
import { ShiftStatus } from '../../shifts/shift-status.enum';

describe('VoidIntakeCommand', () => {
  let manager: IntakesMocks['manager'];
  let dataSource: IntakesMocks['dataSource'];
  let shifts: IntakesMocks['shifts'];
  let audit: IntakesMocks['audit'];
  let payouts: IntakesMocks['payouts'];
  let allocations: IntakesMocks['allocations'];
  let crates: IntakesMocks['crates'];
  let command: VoidIntakeCommand;

  beforeEach(() => {
    const mocks = makeIntakesMocks();
    ({ manager, dataSource, shifts, audit, payouts, allocations, crates } = mocks);
    command = buildIntakes(mocks).voidCmd;
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
     * «спроба анулювати той самий документ удруге → кнопки просто немає» is a
     * statement about the record, not just the button.
     */
    it('reads the row under a row lock, inside the transaction', async () => {
      await command.void(oksana, INTAKE_ID, { reason: 'помилка ваги' });

      expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
        where: { id: INTAKE_ID },
        lock: { mode: 'pessimistic_write' },
      });
      expect(dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
        manager.findOne.mock.invocationCallOrder[0],
      );
    });

    it('reads the shift inside the same transaction', async () => {
      await command.void(oksana, INTAKE_ID, { reason: 'помилка ваги' });

      expect(shifts.findOneRaw).toHaveBeenCalledWith(SHIFT_ID, manager);
    });

    it('lets an operator void THEIR OWN intake while the shift is open', async () => {
      await expect(
        command.void(oksana, INTAKE_ID, { reason: 'помилка ваги' }),
      ).resolves.toBeDefined();
    });

    /**
     * §9.4 — «чужа квитанція → приймальник НІКОЛИ, навіть на своїй точці і в ту
     * саму зміну». Not hypothetical: §10.6 describes Оксана leaving her account
     * at 14:00 and Марія entering hers at 14:01, both signing receipts inside
     * ONE shift at ONE point. A point-scoped rule would let Марія void Оксана's.
     */
    it('403s an operator voiding a COLLEAGUE’s intake in the same open shift', async () => {
      await expect(command.void(maria, INTAKE_ID, { reason: 'не моя' })).rejects.toMatchObject({
        response: { code: 'NOT_YOUR_DOCUMENT' },
      });
    });

    it('403s the author once the shift is closed', async () => {
      // The freeze line the shift close draws (§9.4, правка 30.09.2026).
      shifts.findOneRaw.mockResolvedValue(
        shift({ closed_at: new Date(), status: ShiftStatus.Closed }),
      );

      await expect(command.void(oksana, INTAKE_ID, { reason: 'пізно' })).rejects.toMatchObject({
        response: { code: 'SHIFT_CLOSED' },
      });
    });

    it('403s even the owner once the shift is closed, writing nothing', async () => {
      // 2026-09-30: a closed day is frozen for everyone, the owner included.
      shifts.findOneRaw.mockResolvedValue(
        shift({ closed_at: new Date(), status: ShiftStatus.Closed }),
      );

      await expect(command.void(owner, INTAKE_ID, { reason: 'перевірка' })).rejects.toMatchObject({
        response: { code: 'SHIFT_CLOSED' },
      });
      expect(manager.save).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(crates.voidReturnForIntake).not.toHaveBeenCalled();
    });

    it('lets the owner void a colleague’s intake while the shift is open', async () => {
      await expect(command.void(owner, INTAKE_ID, { reason: 'перевірка' })).resolves.toBeDefined();
    });

    it('404s an intake at another point for an operator', async () => {
      await expect(command.void(elsewhere, INTAKE_ID, { reason: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('409s an already-voided intake', async () => {
      // §9.3 — «спроба анулювати той самий документ удруге → кнопки просто немає».
      manager.findOne.mockResolvedValue(
        intake({ voided_at: new Date(), voided_by_user_id: 'u-owner', void_reason: 'вже' }),
      );

      await expect(command.void(owner, INTAKE_ID, { reason: 'ще раз' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('writes the whole trio and audits with the reason', async () => {
      await command.void(oksana, INTAKE_ID, { reason: 'помилка ваги: 62,40 замість 26,40' });

      const saved = manager.save.mock.calls[0][1] as Record<string, unknown>;
      expect(saved.voided_at).toBeInstanceOf(Date);
      expect(saved.voided_by_user_id).toBe('u-oksana');
      expect(saved.void_reason).toBe('помилка ваги: 62,40 замість 26,40');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'intake.voided', note: expect.any(String) }),
        manager,
      );
    });

    it('reads the row extras AFTER allocating, so open_amount reflects the release', async () => {
      await command.void(oksana, INTAKE_ID, { reason: 'помилка' });
      const extrasCall = manager.query.mock.calls.findIndex(([sql]) =>
        /AS net_kg/.test(sql as string),
      );
      expect(manager.query.mock.invocationCallOrder[extrasCall]).toBeGreaterThan(
        allocations.allocate.mock.invocationCallOrder[0],
      );
    });

    it('voids the linked crate return with the same reason, after the intake’s own void', async () => {
      await command.void(oksana, INTAKE_ID, { reason: 'не той постачальник' });

      expect(crates.voidReturnForIntake).toHaveBeenCalledWith(manager, {
        actor: oksana,
        intakeId: INTAKE_ID,
        reason: 'не той постачальник',
      });
      const voided = crates.voidReturnForIntake.mock.invocationCallOrder[0];
      expect(allocations.lockSupplier.mock.invocationCallOrder[0]).toBeLessThan(voided);
      expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(voided);
    });

    it('does not touch the crate return when the void itself is refused', async () => {
      await expect(command.void(maria, INTAKE_ID, { reason: 'не моя' })).rejects.toBeDefined();
      expect(crates.voidReturnForIntake).not.toHaveBeenCalled();
    });

    it('does NOT refuse a void that drives the supplier’s debt negative', async () => {
      // «анулювання КВИТАНЦІЇ ЄДИНИЙ шлях у мінус, і воно ДОЗВОЛЕНЕ, з попередженням».
      // There is no balance lookup in this path at all, and adding a floor check
      // would contradict «інваріанта борг >= 0 в цій схемі теж немає».
      await expect(command.void(owner, INTAKE_ID, { reason: 'анулювання' })).resolves.toBeDefined();
    });

    describe('with a live bound payout, open shift', () => {
      const bound = { id: 'po-1', code: 'KPG-PO-20260908-001', amount: '1500.00', voided_at: null };
      beforeEach(() => payouts.findLiveBoundToIntake.mockResolvedValue(bound));

      it('locks the payout after the intake, in the same transaction', async () => {
        await command.void(oksana, INTAKE_ID, { reason: 'r' });

        expect(payouts.findLiveBoundToIntake).toHaveBeenCalledWith(manager, INTAKE_ID);
        // Compare against the LOCKED intake read (the `FOR UPDATE` find), not
        // the unlocked stub read — that one always runs first and would pass
        // this assertion even if the payout lock jumped ahead of it.
        const locked = manager.findOne.mock.calls.findIndex(([, opts]) => opts?.lock);
        expect(manager.findOne.mock.invocationCallOrder[locked]).toBeLessThan(
          payouts.findLiveBoundToIntake.mock.invocationCallOrder[0],
        );
      });

      it('always voids the payout with the cash returned', async () => {
        await command.void(oksana, INTAKE_ID, { reason: 'помилка' });

        expect(payouts.void).toHaveBeenCalledWith(manager, oksana, bound, 'помилка', true);
        expect(payouts.settleReturn).not.toHaveBeenCalled();
      });

    });

    it('locks the supplier before the intake row, releases the intake, allocates once', async () => {
      await command.void(owner, INTAKE_ID, { reason: 'x' });

      expect(allocations.lockSupplier).toHaveBeenCalledWith(manager, SUPPLIER);
      const locked = manager.findOne.mock.calls.findIndex(([, opts]) => opts?.lock);
      expect(allocations.lockSupplier.mock.invocationCallOrder[0]).toBeLessThan(
        manager.findOne.mock.invocationCallOrder[locked],
      );
      expect(allocations.release).toHaveBeenCalledWith(manager, { intakeId: INTAKE_ID });
      expect(allocations.allocate).toHaveBeenCalledTimes(1);
      expect(allocations.allocate).toHaveBeenCalledWith(manager, SUPPLIER);
    });

    it('with a bound payout in an open shift, allocates once, after both voids', async () => {
      payouts.findLiveBoundToIntake.mockResolvedValue({
        id: 'po-1',
        amount: '1.00',
        voided_at: null,
      });
      await command.void(owner, INTAKE_ID, { reason: 'x' });

      expect(allocations.allocate).toHaveBeenCalledTimes(1);
      expect(allocations.allocate.mock.invocationCallOrder[0]).toBeGreaterThan(
        payouts.void.mock.invocationCallOrder[0],
      );
    });

    it('404s a missing intake before any lock', async () => {
      manager.findOne.mockResolvedValue(null);
      await expect(command.void(owner, 'nope', { reason: 'x' })).rejects.toThrow(
        'Intake not found',
      );
      expect(allocations.lockSupplier).not.toHaveBeenCalled();
    });

    it('still 404s another point for an operator, releasing nothing', async () => {
      await expect(command.void(elsewhere, INTAKE_ID, { reason: 'x' })).rejects.toThrow(
        'Intake not found',
      );
      expect(allocations.release).not.toHaveBeenCalled();
      expect(allocations.allocate).not.toHaveBeenCalled();
    });

  });
});
