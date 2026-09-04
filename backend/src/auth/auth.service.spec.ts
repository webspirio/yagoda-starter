import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { validate } from 'class-validator';
import { AuthService, normalizeUsername } from './auth.service';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { AuditService } from '../audit/audit.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { authConfig } from '../config/auth.config';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

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

  describe('register', () => {
    it('creates the user, stores credentials in the same transaction, and returns a token', async () => {
      users.findByIdentity.mockResolvedValue(null);
      users.createWithIdentity.mockImplementation(async (_input, onCreated) => {
        const user = { id: 'u1', display_name: 'Alice', avatar_url: null };
        if (onCreated) await onCreated(user, 'MANAGER');
        return { user, identity: { provider_user_id: 'alice' } };
      });

      await expect(service.register({ username: 'Alice', password: 'hunter2!!' })).resolves.toEqual(
        { access_token: 'signed.jwt.token' },
      );

      expect(users.createWithIdentity).toHaveBeenCalledWith(
        expect.objectContaining({ provider: LOCAL_PROVIDER, providerUserId: 'alice' }),
        expect.any(Function),
      );
      expect(credentials.set).toHaveBeenCalledWith('u1', 'hunter2!!', 'MANAGER');
    });

    it('rejects a username that is already taken, with a machine-readable code', async () => {
      users.findByIdentity.mockResolvedValue({ user: { id: 'u1' } });

      const error = await service
        .register({ username: 'alice', password: 'hunter2!!' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'USERNAME_TAKEN',
      });
      expect(users.createWithIdentity).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns a token for correct credentials', async () => {
      users.findByIdentity.mockResolvedValue({
        provider_user_id: 'alice',
        user: { id: 'u1', is_active: true, display_name: 'Alice', avatar_url: null },
      });
      credentials.verify.mockResolvedValue(true);

      await expect(service.login({ username: 'Alice', password: 'hunter2!!' })).resolves.toEqual({
        access_token: 'signed.jwt.token',
      });
    });

    it('signs the username and profile into the token, and never the password', async () => {
      users.findByIdentity.mockResolvedValue({
        provider_user_id: 'alice',
        user: { id: 'u1', is_active: true, display_name: 'Alice', avatar_url: '/uploads/a.webp' },
      });
      credentials.verify.mockResolvedValue(true);

      await service.login({ username: 'alice', password: 'hunter2!!' });

      expect(jwt.sign).toHaveBeenCalledWith({
        sub: 'u1',
        username: 'alice',
        display_name: 'Alice',
        avatar_url: '/uploads/a.webp',
      });
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
        user: { id: 'u1', is_active: true, display_name: null, avatar_url: null },
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
        display_name: 'Alice',
        avatar_url: null,
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

    it('rejects a short password on RegisterDto', async () => {
      const dto = Object.assign(new RegisterDto(), { username: 'admin', password: shortPassword });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });

    it('accepts the same short password on LoginDto', async () => {
      const dto = Object.assign(new LoginDto(), { username: 'admin', password: shortPassword });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
