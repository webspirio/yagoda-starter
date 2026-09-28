import { BadRequestException } from '@nestjs/common';
import { assertPayoutDecision } from './payout-decision';

const code = (c: string) =>
  expect.objectContaining({ response: expect.objectContaining({ code: c }) });

describe('assertPayoutDecision', () => {
  describe('open shift — the payout always goes with the receipt', () => {
    it('takes no decision, bound payout or not', () => {
      expect(() =>
        assertPayoutDecision({ shiftClosed: false, hasLivePayout: true }, undefined),
      ).not.toThrow();
      expect(() =>
        assertPayoutDecision({ shiftClosed: false, hasLivePayout: false }, undefined),
      ).not.toThrow();
    });

    it.each(['keep', 'void', 'void_returned'] as const)('rejects %s', (d) => {
      expect(() => assertPayoutDecision({ shiftClosed: false, hasLivePayout: true }, d)).toThrow(
        BadRequestException,
      );
      expect(() => assertPayoutDecision({ shiftClosed: false, hasLivePayout: true }, d)).toThrow(
        code('PAYOUT_DECISION_NOT_APPLICABLE'),
      );
    });
  });

  describe('closed shift — #125 as before', () => {
    it('requires a decision when a live payout is bound', () => {
      expect(() =>
        assertPayoutDecision({ shiftClosed: true, hasLivePayout: true }, undefined),
      ).toThrow(code('PAYOUT_DECISION_REQUIRED'));
    });

    it('rejects a decision when nothing is bound', () => {
      expect(() =>
        assertPayoutDecision({ shiftClosed: true, hasLivePayout: false }, 'keep'),
      ).toThrow(code('PAYOUT_DECISION_NOT_APPLICABLE'));
    });

    it.each(['keep', 'void', 'void_returned'] as const)('accepts %s', (d) => {
      expect(() =>
        assertPayoutDecision({ shiftClosed: true, hasLivePayout: true }, d),
      ).not.toThrow();
    });
  });
});
