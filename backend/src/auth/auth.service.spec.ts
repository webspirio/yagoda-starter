import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { validate } from 'class-validator';
import { AuthService, normalizeUsername } from './auth.service';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { AuditService } from '../audit/audit.service';
import { authConfig } from '../config/auth.config';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../users/user-role.enum';

describe('AuthService', () => {
  let service: AuthService;
  const users = { findByIdentity: jest.fn(), createWithIdentity: jest.fn() };
  const credentials = { set: jest.fn(), verify: jest.fn() };
  const audit = { record: jest.fn() };
  const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: CredentialsService, useValue: credentials },
        { provide: AuditService, useValue: audit },
        { provide: JwtService, useValue: jwt },
        { provide: authConfig.KEY, useValue: { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '7d' } },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('normalizeUsername', () => {
    it('lowercases and trims so usernames cannot collide by case alone', () => {
      expect(normalizeUsername('  Alice  ')).toBe('alice');
      expect(normalizeUsername('ALICE')).toBe('alice');
    });
  });

  describe('login', () => {
    it('returns a token for correct credentials', async () => {
      users.findByIdentity.mockResolvedValue({
        provider_user_id: 'alice',
        user: { id: 'u1', is_active: true, first_name: 'Alice', last_name: 'Owner', avatar_url: null },
      });
      credentials.verify.mockResolvedValue(true);

      await expect(service.login({ username: 'Alice', password: 'hunter2!!' })).resolves.toEqual({
        access_token: 'signed.jwt.token',
      });
    });

    it('signs only the subject into the token — never the password, and never a stale profile', async () => {
      users.findByIdentity.mockResolvedValue({
        provider_user_id: 'alice',
        user: { id: 'u1', is_active: true, first_name: 'Alice', last_name: 'Owner', avatar_url: '/uploads/a.webp' },
      });
      credentials.verify.mockResolvedValue(true);

      await service.login({ username: 'alice', password: 'hunter2!!' });

      // Nothing but `sub`: role, point and is_active are read from the
      // database on every request (JwtStrategy.validate), so putting a copy
      // of any of them in here would be a fact that can go stale for a week.
      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1' });
    });

    it('rejects an unknown username and a wrong password identically', async () => {
      users.findByIdentity.mockResolvedValue(null);
      const unknown = await service.login({ username: 'nobody', password: 'whatever1' }).catch((e) => e);

      users.findByIdentity.mockResolvedValue({
        provider_user_id: 'alice',
        user: { id: 'u1', is_active: true },
      });
      credentials.verify.mockResolvedValue(false);
      const wrong = await service.login({ username: 'alice', password: 'wrongpass' }).catch((e) => e);

      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect(unknown.message).toBe(wrong.message);
      expect(unknown.getResponse()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('rejects a deactivated account', async () => {
      users.findByIdentity.mockResolvedValue({
        provider_user_id: 'alice',
        user: { id: 'u1', is_active: false },
      });
      credentials.verify.mockResolvedValue(true);

      await expect(
        service.login({ username: 'alice', password: 'hunter2!!' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('records the login in the audit log', async () => {
      users.findByIdentity.mockResolvedValue({
        provider_user_id: 'alice',
        user: { id: 'u1', is_active: true, first_name: 'Alice', last_name: 'Owner', avatar_url: null },
      });
      credentials.verify.mockResolvedValue(true);

      await service.login({ username: 'alice', password: 'hunter2!!' });

      expect(audit.record).toHaveBeenCalledWith({
        action: 'user.logged-in',
        actor_id: 'u1',
        target_type: 'user',
        target_id: 'u1',
      });
    });
  });

  describe('logout', () => {
    it('records the sign-out in the audit log', async () => {
      await service.logout({
        sub: 'u1',
        username: 'alice',
        role: UserRole.NetworkOwner,
        collection_point_id: null,
      });

      expect(audit.record).toHaveBeenCalledWith({
        action: 'user.logged-out',
        actor_id: 'u1',
        target_type: 'user',
        target_id: 'u1',
      });
    });
  });

  // Exercises class-validator's own validate() directly against the DTOs —
  // AuthService's other tests above mock every collaborator and call the
  // service with plain object literals, which never runs through
  // class-validator at all. This is the layer that actually enforces the
  // password policy split; the global ValidationPipe wiring on top of it
  // (main.ts) is proven separately by a live curl login of the seeded
  // admin/admin account — see the report.
  describe('password length policy', () => {
    const shortPassword = 'admin'; // exactly what the dev seed uses

    it('accepts the same short password on LoginDto', async () => {
      const dto = Object.assign(new LoginDto(), { username: 'admin', password: shortPassword });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
