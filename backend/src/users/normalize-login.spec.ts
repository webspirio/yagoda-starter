import { normalizeLogin } from './normalize-login';

// Moved here from auth.service.spec.ts along with the function itself: the
// rule now serves `auth` AND `user-admin`, so it is tested where it lives
// rather than beside one of its two callers.
describe('normalizeLogin', () => {
  it('lowercases and trims so logins cannot collide by case alone', () => {
    expect(normalizeLogin('  Alice  ')).toBe('alice');
    expect(normalizeLogin('ALICE')).toBe('alice');
  });
});
