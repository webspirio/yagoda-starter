import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { assertPayoutDecision } from './payout-decision';

const owner = { sub: 'o', username: 'o', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'a', username: 'a', role: UserRole.PointOperator, collection_point_id: 'p' };

describe('assertPayoutDecision', () => {
  it('requires a decision when a live payout is bound', () => {
    expect(() => assertPayoutDecision(operator, true, undefined)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'PAYOUT_DECISION_REQUIRED' }) }),
    );
  });

  it('rejects a decision when no live payout is bound', () => {
    expect(() => assertPayoutDecision(owner, false, 'keep')).toThrow(BadRequestException);
    expect(() => assertPayoutDecision(owner, false, 'keep')).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'PAYOUT_DECISION_NOT_APPLICABLE' }) }),
    );
  });

  it('keeps void_returned for the owner', () => {
    expect(() => assertPayoutDecision(operator, true, 'void_returned')).toThrow(ForbiddenException);
    expect(() => assertPayoutDecision(operator, true, 'void_returned')).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'OWNER_ONLY' }) }),
    );
    expect(() => assertPayoutDecision(owner, true, 'void_returned')).not.toThrow();
  });

  it('accepts keep and void from an operator, and nothing when nothing is bound', () => {
    expect(() => assertPayoutDecision(operator, true, 'keep')).not.toThrow();
    expect(() => assertPayoutDecision(operator, true, 'void')).not.toThrow();
    expect(() => assertPayoutDecision(operator, false, undefined)).not.toThrow();
  });
});
