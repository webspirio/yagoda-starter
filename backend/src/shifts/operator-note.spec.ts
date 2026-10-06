import { ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import {
  NO_FACTS,
  couldEditOperatorNote,
  loadOperatorNoteFacts,
  operatorNoteEditable,
  operatorNoteRefusal,
} from './operator-note';

const closer = { sub: 'u-op', username: 'op', role: UserRole.PointOperator, collection_point_id: 'p1' };
const colleague = { ...closer, sub: 'u-op-2', username: 'op2' };
const owner = { sub: 'u-own', username: 'own', role: UserRole.NetworkOwner, collection_point_id: null };

const closed = { closed_at: new Date(), closed_by_user_id: 'u-op', explanation: null };
const ok = { is_newest: true, has_discrepancy: true };

const code = (e: unknown) => (e as { getResponse(): { code: string } }).getResponse().code;

describe('operatorNoteRefusal', () => {
  it('allows the closer while every condition holds', () => {
    expect(operatorNoteRefusal(closer, closed, ok)).toBeNull();
  });

  it('refuses an open shift first', () => {
    const r = operatorNoteRefusal(closer, { ...closed, closed_at: null }, NO_FACTS);
    expect(r).toBeInstanceOf(ConflictException);
    expect(code(r)).toBe('SHIFT_NOT_CLOSED');
  });

  it('refuses anyone but the closer', () => {
    const r = operatorNoteRefusal(colleague, closed, ok);
    expect(r).toBeInstanceOf(ForbiddenException);
    expect(code(r)).toBe('NOT_SHIFT_CLOSER');
  });

  it('refuses once the next shift exists', () => {
    expect(code(operatorNoteRefusal(closer, closed, { ...ok, is_newest: false }))).toBe(
      'OPERATOR_NOTE_WINDOW_CLOSED',
    );
  });

  it('refuses after the owner decided', () => {
    expect(code(operatorNoteRefusal(closer, { ...closed, explanation: 'з\'ясовано' }, ok))).toBe(
      'OWNER_ALREADY_EXPLAINED',
    );
  });

  it("treats a legacy '' explanation as undecided — the owner's list does too", () => {
    expect(operatorNoteRefusal(closer, { ...closed, explanation: '' }, ok)).toBeNull();
  });

  it('refuses a close that matched', () => {
    expect(code(operatorNoteRefusal(closer, closed, { ...ok, has_discrepancy: false }))).toBe(
      'NO_DISCREPANCY',
    );
  });
});

describe('operatorNoteEditable', () => {
  it('is the absence of a refusal for an operator', () => {
    expect(operatorNoteEditable(closer, closed, ok)).toBe(true);
    expect(operatorNoteEditable(closer, closed, NO_FACTS)).toBe(false);
  });

  it('is false for the owner whatever the facts', () => {
    expect(operatorNoteEditable(owner, { ...closed, closed_by_user_id: 'u-own' }, ok)).toBe(false);
  });
});

describe('couldEditOperatorNote', () => {
  it('needs no facts to rule out the owner, an open shift, another closer or a decided one', () => {
    expect(couldEditOperatorNote(closer, closed)).toBe(true);
    expect(couldEditOperatorNote(owner, closed)).toBe(false);
    expect(couldEditOperatorNote(closer, { ...closed, closed_at: null })).toBe(false);
    expect(couldEditOperatorNote(colleague, closed)).toBe(false);
    expect(couldEditOperatorNote(closer, { ...closed, explanation: 'так' })).toBe(false);
  });
});

describe('loadOperatorNoteFacts', () => {
  it('asks nothing for no ids', async () => {
    const m = { query: jest.fn() };
    expect((await loadOperatorNoteFacts(m as never, [])).size).toBe(0);
    expect(m.query).not.toHaveBeenCalled();
  });

  it('maps rows by shift id', async () => {
    const m = {
      query: jest.fn().mockResolvedValue([{ id: 's1', is_newest: true, has_discrepancy: false }]),
    };
    const facts = await loadOperatorNoteFacts(m as never, ['s1']);
    expect(facts.get('s1')).toEqual({ is_newest: true, has_discrepancy: false });
    expect(m.query).toHaveBeenCalledWith(expect.stringContaining('NOT EXISTS'), [['s1']]);
  });
});
