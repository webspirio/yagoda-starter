import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { VoidDocumentDto } from './void-document.dto';

/**
 * ONE DTO, THREE MODULES. `intakes`, `payouts` and `transfers` all void through
 * this class, so this spec is the single place §9.3's «сторно повне, з
 * обов'язковою причиною» is enforced for all of them.
 *
 * The blank case is the one that mattered: `@Length(1, 500)` counts characters,
 * so `"   "` passed validation and every service then trimmed it to `''` before
 * writing — a voided document with no reason, which is exactly what §9.3
 * forbids and what «кнопка неактивна» describes on the client.
 */
const errorsFor = (reason: unknown): string[] => {
  const dto = plainToInstance(VoidDocumentDto, { reason });
  return validateSync(dto).flatMap((e) => Object.keys(e.constraints ?? {}));
};

describe('VoidDocumentDto', () => {
  it('accepts a real reason', () => {
    expect(errorsFor('дубль квитанції')).toEqual([]);
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

  it('still accepts a reason with surrounding whitespace — the service trims', () => {
    // The tightening is exactly that, a tightening: nothing valid under §9.3
    // became invalid. A padded reason has a non-space character and survives.
    expect(errorsFor('  дубль  ')).toEqual([]);
  });
});
