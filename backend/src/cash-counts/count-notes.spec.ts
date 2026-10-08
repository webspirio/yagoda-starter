import { countNoteAllowed, countNoteRefusal, type NoteCount } from './count-notes';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const OPERATOR = { sub: 'op-1', role: UserRole.PointOperator, collection_point_id: 'p1' } as AuthenticatedUser;
const OTHER_OP = { sub: 'op-2', role: UserRole.PointOperator, collection_point_id: 'p1' } as AuthenticatedUser;
const OWNER = { sub: 'own', role: UserRole.NetworkOwner, collection_point_id: null } as AuthenticatedUser;

const count = (over: Partial<NoteCount> = {}): NoteCount => ({
  book: CashBook.Berry,
  kind: CashCountKind.Closing,
  counted_amount: '90.00',
  expected_amount: '100.00',
  counted_by_user_id: 'op-1',
  explanation: null,
  ...over,
});
const code = (e: ReturnType<typeof countNoteRefusal>) =>
  (e?.getResponse() as { code?: string } | undefined)?.code ?? null;

describe('countNoteRefusal', () => {
  it('lets the counter write a note on a disagreeing opening or closing count', () => {
    expect(countNoteRefusal(OPERATOR, count(), 'operator_note')).toBeNull();
    expect(countNoteRefusal(OPERATOR, count({ kind: CashCountKind.Opening }), 'operator_note')).toBeNull();
  });

  it('refuses another operator — NOT_COUNTER', () => {
    expect(code(countNoteRefusal(OTHER_OP, count(), 'operator_note'))).toBe('NOT_COUNTER');
  });

  it('refuses an operator the explanation — OWNER_ONLY', () => {
    expect(code(countNoteRefusal(OPERATOR, count(), 'explanation'))).toBe('OWNER_ONLY');
  });

  it('checks the role before the row: an operator explaining a midday row is OWNER_ONLY', () => {
    expect(code(countNoteRefusal(OPERATOR, count({ kind: CashCountKind.Midday }), 'explanation'))).toBe('OWNER_ONLY');
  });

  it('refuses a midday row and the crates book — COUNT_NOT_EXPLAINABLE', () => {
    expect(code(countNoteRefusal(OPERATOR, count({ kind: CashCountKind.Midday }), 'operator_note'))).toBe('COUNT_NOT_EXPLAINABLE');
    expect(code(countNoteRefusal(OWNER, count({ book: CashBook.Crates }), 'explanation'))).toBe('COUNT_NOT_EXPLAINABLE');
  });

  it('refuses a matched count — NO_DISCREPANCY', () => {
    expect(code(countNoteRefusal(OWNER, count({ counted_amount: '100.00' }), 'explanation'))).toBe('NO_DISCREPANCY');
  });

  it("refuses the operator once the owner explained THIS count — OWNER_ALREADY_EXPLAINED", () => {
    expect(code(countNoteRefusal(OPERATOR, count({ explanation: 'вирішено' }), 'operator_note'))).toBe('OWNER_ALREADY_EXPLAINED');
  });

  it('lets the owner replace an explanation', () => {
    expect(countNoteRefusal(OWNER, count({ explanation: 'було' }), 'explanation')).toBeNull();
  });

  it('checks the author before the row: another operator on a midday row is NOT_COUNTER', () => {
    expect(code(countNoteRefusal(OTHER_OP, count({ kind: CashCountKind.Midday }), 'operator_note'))).toBe('NOT_COUNTER');
  });
});

describe('countNoteAllowed', () => {
  it('is false for the owner on the operator note, whatever the count', () => {
    expect(countNoteAllowed(OWNER, count({ counted_by_user_id: 'own' }), 'operator_note')).toBe(false);
  });
  it('is true for the owner on a disagreeing count', () => {
    expect(countNoteAllowed(OWNER, count(), 'explanation')).toBe(true);
  });
});
