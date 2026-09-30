import { isLocalDbHost } from './local-db-host';

/**
 * The dev seed's "is this database mine to overwrite?" check. A host that is
 * not the laptop itself or the stack's own Postgres service must be refused,
 * or a `.env` pointing at staging gets demo rows.
 */
describe('isLocalDbHost', () => {
  it.each(['localhost', '127.0.0.1', '::1', 'postgres'])(
    'accepts the laptop or the compose service: %s',
    (host) => {
      expect(isLocalDbHost(host)).toBe(true);
    },
  );

  it("accepts the compose service under Coolify's preview suffix", () => {
    // Coolify renames every service of a PR preview to `<name>-pr-<N>`
    // (docs/coolify-deploy.md); the seed runs there on purpose.
    expect(isLocalDbHost('postgres-pr-179')).toBe(true);
  });

  it.each([
    'db.example.com',
    '10.0.0.5',
    'postgres-prod',
    'postgres-pr-',
    'postgres-pr-1x',
    'staging-postgres-pr-179',
    '',
  ])('refuses anything else: %p', (host) => {
    expect(isLocalDbHost(host)).toBe(false);
  });
});
