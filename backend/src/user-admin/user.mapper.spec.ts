import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserRole } from '../users/user-role.enum';
import type { User } from '../users/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { toUserResponse } from './user.mapper';

/** The global ValidationPipe's options (main.ts) — what a real request goes through. */
const PIPE = { whitelist: true, forbidNonWhitelisted: true };

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

// The number is assigned by the database (GENERATED ALWAYS) and never typed:
// a body that names it is refused outright, not silently dropped.
describe('the user number is read-only', () => {
  it.each<[string, new () => object]>([
    ['create', CreateUserDto],
    ['update', UpdateUserDto],
  ])('%s refuses a body that sets number', async (_, Dto) => {
    const errors = await validate(plainToInstance(Dto, { number: 9 }), PIPE);
    expect(errors.some((e) => e.property === 'number')).toBe(true);
  });
});
