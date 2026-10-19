import { describe, expect, it } from 'vitest';
import { canVoidPayout } from './canVoidPayout';

const owner = { id: 'owner', role: 'network_owner' } as const;
const author = { id: 'author', role: 'point_operator' } as const;
const other = { id: 'other', role: 'point_operator' } as const;

const payout = (over: { voided_at?: string | null; shift_closed?: boolean } = {}) => ({
  paid_by_user_id: 'author',
  voided_at: null,
  shift_closed: false,
  ...over,
});

describe('canVoidPayout — §9.4', () => {
  it('owner may void in an open shift', () => {
    expect(canVoidPayout(owner, payout())).toBe(true);
  });
  it('owner may void in a closed shift', () => {
    expect(canVoidPayout(owner, payout({ shift_closed: true }))).toBe(true);
  });
  it('operator may void their own payout in an open shift', () => {
    expect(canVoidPayout(author, payout())).toBe(true);
  });
  it('operator may not void their own payout in a closed shift', () => {
    expect(canVoidPayout(author, payout({ shift_closed: true }))).toBe(false);
  });
  it("operator may not void another's payout", () => {
    expect(canVoidPayout(other, payout())).toBe(false);
  });
  it.each([owner, author, other])('nobody voids a voided payout (%o)', (v) => {
    expect(canVoidPayout(v, payout({ voided_at: '2026-10-13T10:00:00Z' }))).toBe(false);
  });
});
