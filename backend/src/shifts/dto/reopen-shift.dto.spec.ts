import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ReopenShiftDto } from './reopen-shift.dto';

/**
 * THE SAME BLANK-REASON HOLE `VoidDocumentDto` CLOSED, in the one place that
 * kept it. Reopening is the owner's correction verb (§10.2) and the reason is
 * the only thing that survives it: the shift row goes back to `open` and the
 * `shift.reopened` audit entry is the whole record of why. `@Length(1, 500)`
 * counts characters, so `{"reason":"   "}` reached that entry as whitespace.
 *
 * Mirrors `intakes/dto/void-document.dto.spec.ts` case for case on purpose —
 * the two DTOs make the same promise and should fail the same way.
 */
const errorsFor = (reason: unknown): string[] => {
  const dto = plainToInstance(ReopenShiftDto, { reason });
  return validateSync(dto).flatMap((e) => Object.keys(e.constraints ?? {}));
};

describe('ReopenShiftDto', () => {
  it('accepts a real reason', () => {
    expect(errorsFor('закрили помилково о 11:00')).toEqual([]);
  });

  it.each(['   ', '\t', '\n', ' \t\n '])('REFUSES the whitespace-only %j', (reason) => {
    expect(errorsFor(reason)).toContain('matches');
  });

  it('refuses an empty string and a missing reason', () => {
    expect(errorsFor('')).not.toEqual([]);
    expect(errorsFor(undefined)).not.toEqual([]);
  });

  it('refuses a reason over 500 characters', () => {
    expect(errorsFor('я'.repeat(501))).toContain('isLength');
  });

  it('still accepts a reason with surrounding whitespace', () => {
    // A tightening, not a new rule: nothing an owner could legitimately type
    // became invalid.
    expect(errorsFor('  закрили помилково  ')).toEqual([]);
  });
});
