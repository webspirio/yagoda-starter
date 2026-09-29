import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../jwt.strategy';
import { assertCanSee, assertCanVoid } from './document-access';

const A = 'point-a';
const B = 'point-b';
const owner = {
  sub: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
} as AuthenticatedUser;
const oksana = {
  sub: 'oksana',
  role: UserRole.PointOperator,
  collection_point_id: A,
} as AuthenticatedUser;
const open = { collection_point_id: A, closed_at: null };
const closed = { collection_point_id: A, closed_at: new Date('2026-09-08T18:00:00Z') };
const CLOSED_MSG = 'That shift is closed -- ask the network owner';

describe('assertCanSee', () => {
  it('lets the owner see any point', () => {
    expect(() =>
      assertCanSee(owner, { collection_point_id: B, closed_at: null }, 'X not found'),
    ).not.toThrow();
  });

  it('lets an operator see their own point', () => {
    expect(() => assertCanSee(oksana, open, 'X not found')).not.toThrow();
  });

  it("404s - never 403s - another point for an operator, with the caller's text", () => {
    const run = () =>
      assertCanSee(oksana, { collection_point_id: B, closed_at: null }, 'Payout not found');
    expect(run).toThrow(NotFoundException);
    expect(run).toThrow('Payout not found');
  });
});

describe('assertCanVoid', () => {
  it.each([
    ["owner, someone else's, closed shift", owner, 'maria', closed],
    ['operator, own, open shift', oksana, 'oksana', open],
  ])('allows %s', (_label, actor, authorId, shift) => {
    expect(() => assertCanVoid(actor, { authorId, shift }, CLOSED_MSG)).not.toThrow();
  });

  it("403s NOT_YOUR_DOCUMENT for a colleague's document in an open shift", () => {
    try {
      assertCanVoid(oksana, { authorId: 'maria', shift: open }, CLOSED_MSG);
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toEqual({
        message: 'You can only void a document you recorded yourself',
        code: 'NOT_YOUR_DOCUMENT',
      });
    }
  });

  it("checks authorship before the shift: a colleague's document in a closed shift is NOT_YOUR_DOCUMENT", () => {
    expect(() => assertCanVoid(oksana, { authorId: 'maria', shift: closed }, CLOSED_MSG)).toThrow(
      'You can only void a document you recorded yourself',
    );
  });

  it("403s SHIFT_CLOSED with the caller's message for the author once the shift is closed", () => {
    try {
      assertCanVoid(
        oksana,
        { authorId: 'oksana', shift: closed },
        'That shift is closed -- ask the network owner to void it',
      );
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toEqual({
        message: 'That shift is closed -- ask the network owner to void it',
        code: 'SHIFT_CLOSED',
      });
    }
  });
});
