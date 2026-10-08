import { toCashCountRowResponse, type CashCountRow } from './cash-count.mapper';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const OPERATOR = { sub: 'op-1', role: UserRole.PointOperator, collection_point_id: 'p1' } as AuthenticatedUser;
const OWNER = { sub: 'own', role: UserRole.NetworkOwner, collection_point_id: null } as AuthenticatedUser;

const row = (over: Partial<CashCountRow> = {}): CashCountRow => ({
  id: 'c1',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-10-08',
  book: CashBook.Berry,
  kind: CashCountKind.Closing,
  counted_amount: '90.00',
  expected_amount: '100.00',
  counted_by_user_id: 'op-1',
  counted_at: new Date('2026-10-08T15:00:00Z'),
  explanation: 'утримати з Петренка',
  operator_note: 'видала без квитанції',
  ...over,
});

describe('toCashCountRowResponse — the owner explanation is the owner’s to read', () => {
  it('gives the owner the text', () => {
    const r = toCashCountRowResponse(row(), new Map(), OWNER);
    expect(r).toMatchObject({ explanation: 'утримати з Петренка', explained: true });
  });

  it('withholds the text from an operator but says the count is explained', () => {
    const r = toCashCountRowResponse(row(), new Map(), OPERATOR);
    expect(r).toMatchObject({ explanation: null, explained: true, operator_note: 'видала без квитанції' });
  });

  it('reads explained: false while nobody explained it', () => {
    const r = toCashCountRowResponse(row({ explanation: null }), new Map(), OPERATOR);
    expect(r).toMatchObject({ explanation: null, explained: false, is_open: true });
  });
});
