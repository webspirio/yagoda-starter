import { describe, expect, it } from 'vitest';
import { canVoidIntake } from './canVoidIntake';

const viewers = {
  owner: { id: 'owner', role: 'network_owner' },
  author: { id: 'author', role: 'point_operator' },
  'another operator': { id: 'other', role: 'point_operator' },
} as const;

const intake = (over: { voided_at?: string | null; shift_closed?: boolean } = {}) => ({
  received_by_user_id: 'author',
  voided_at: null,
  shift_closed: false,
  ...over,
});

describe('canVoidIntake — §9.4', () => {
  it.each([
    // viewer, voided, shift closed, expected
    ['owner', false, false, true],
    ['owner', false, true, true],
    ['owner', true, false, false],
    ['owner', true, true, false],
    ['author', false, false, true],
    ['author', false, true, false],
    ['author', true, false, false],
    ['author', true, true, false],
    ['another operator', false, false, false],
    ['another operator', false, true, false],
    ['another operator', true, false, false],
    ['another operator', true, true, false],
  ] as const)('%s, voided=%s, closed=%s → %s', (who, voided, closed, expected) => {
    expect(
      canVoidIntake(viewers[who], intake({ voided_at: voided ? '2026-09-28T10:00:00Z' : null, shift_closed: closed })),
    ).toBe(expected);
  });
});
