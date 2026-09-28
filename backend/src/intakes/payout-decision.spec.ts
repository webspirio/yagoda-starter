import { BadRequestException } from '@nestjs/common';
import { assertPayoutDecision } from './payout-decision';

const code = (c: string) => expect.objectContaining({ response: expect.objectContaining({ code: c }) });

describe('assertPayoutDecision', () => {
  describe('open shift — the payout always goes with the receipt', () => {
    it('takes no decision, bound payout or not', () => {
      expect(() => assertPayoutDecision(false, true, undefined)).not.toThrow();
      expect(() => assertPayoutDecision(false, false, undefined)).not.toThrow();
    });

    it.each(['keep', 'void', 'void_returned'] as const)('rejects %s', (d) => {
      expect(() => assertPayoutDecision(false, true, d)).toThrow(BadRequestException);
      expect(() => assertPayoutDecision(false, true, d)).toThrow(code('PAYOUT_DECISION_NOT_APPLICABLE'));
    });
  });

  describe('closed shift — #125 as before', () => {
    it('requires a decision when a live payout is bound', () => {
      expect(() => assertPayoutDecision(true, true, undefined)).toThrow(code('PAYOUT_DECISION_REQUIRED'));
    });

    it('rejects a decision when nothing is bound', () => {
      expect(() => assertPayoutDecision(true, false, 'keep')).toThrow(code('PAYOUT_DECISION_NOT_APPLICABLE'));
    });

    it.each(['keep', 'void', 'void_returned'] as const)('accepts %s', (d) => {
      expect(() => assertPayoutDecision(true, true, d)).not.toThrow();
    });
  });
});
