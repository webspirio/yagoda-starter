import { UserRole } from '../users/user-role.enum';
import type { User } from '../users/user.entity';
import { toUserResponse } from './user.mapper';

describe('toUserResponse', () => {
  it('carries the number the receipt header prints as «Приймальник № N» (#250)', () => {
    const user = {
      id: 'u1',
      first_name: 'Оксана',
      last_name: 'Коваль',
      number: 5,
      role: UserRole.PointOperator,
      collection_point_id: 'p1',
      is_active: false,
      avatar_url: null,
      created_at: new Date('2026-10-20T08:00:00Z'),
    } as User;

    // A deactivated user keeps their number: old receipts still print it.
    expect(toUserResponse(user, 'oksana')).toMatchObject({ number: 5, is_active: false });
  });
});
