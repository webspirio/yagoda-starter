/** Hosts a dev database answers on: the laptop itself, or the compose service. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/**
 * Coolify renames every service of a PR preview to `<name>-pr-<N>`
 * (docs/coolify-deploy.md), so the stack's own Postgres is `postgres-pr-179`
 * there — still the compose service, just under the platform's suffix.
 */
const PREVIEW_POSTGRES = /^postgres-pr-\d+$/;

/**
 * Whether `host` is a database the dev seed may fill: the laptop or the
 * stack's own Postgres. Anything else (a staging hostname, an IP) is refused
 * unless the operator overrides it — see dev-seed.cli.ts.
 */
export function isLocalDbHost(host: string): boolean {
  return LOCAL_HOSTS.has(host) || PREVIEW_POSTGRES.test(host);
}
