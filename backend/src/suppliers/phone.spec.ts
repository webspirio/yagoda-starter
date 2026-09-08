import { BadRequestException } from '@nestjs/common';
import { canonicalizePhone } from './phone';

describe('canonicalizePhone', () => {
  // The six spellings named in the spec (§5.7) are one human. If any row of
  // this table regresses, `UNIQUE (collection_point_id, phone)` silently stops
  // meaning anything and duplicate suppliers become permanent — правка 6
  // cancelled the merge tool, so there is no way back.
  it.each([
    ['0671234567', '+380671234567'],
    ['067 123 45 67', '+380671234567'],
    ['(067) 123-45-67', '+380671234567'],
    ['067-123-45-67', '+380671234567'],
    ['380671234567', '+380671234567'],
    ['+380671234567', '+380671234567'],
    ['+38 (067) 123-45-67', '+380671234567'],
    ['  +380671234567  ', '+380671234567'],
    // A non-Ukrainian number already in E.164 passes through untouched. The
    // CHECK constraint is the E.164 SHAPE, not +380, so this is storable.
    ['+48123456789', '+48123456789'],
  ])('canonicalizes %s to %s', (input, expected) => {
    expect(canonicalizePhone(input)).toBe(expected);
  });

  it.each([
    ['067123', 'too short for a Ukrainian number'],
    ['+380671234', 'Ukrainian prefix, too few digits'],
    ['+3806712345678', 'Ukrainian prefix, too many digits'],
    ['3806712345', 'Ukrainian prefix, too few digits'],
    ['not-a-phone', 'letters'],
    ['', 'empty'],
    ['   ', 'all whitespace'],
    ['+', 'plus alone'],
    ['++380671234567', 'two plus signs'],
    ['+0671234567', 'E.164 forbids a leading zero after the plus'],
  ])('rejects %s (%s)', (input) => {
    expect(() => canonicalizePhone(input)).toThrow(BadRequestException);
  });

  it('names the accepted forms in the error, so the operator can fix it', () => {
    expect(() => canonicalizePhone('067123')).toThrow(/0XXXXXXXXX/);
  });

  it('carries a machine-readable code', () => {
    try {
      canonicalizePhone('nope');
      fail('expected a BadRequestException');
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'SUPPLIER_PHONE_INVALID',
      });
    }
  });
});
