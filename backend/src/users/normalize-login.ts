/**
 * Logins are compared case-insensitively and stored lowercased, so `Оксана`
 * and `оксана` can never be two accounts. Done here rather than in the
 * database so the existing UNIQUE (provider, provider_user_id) index keeps
 * working for every provider without a functional index.
 *
 * Lives in the users domain rather than in `auth` because two modules now
 * normalise: `auth` on the login path, and `user-admin` when the owner
 * creates an account or changes someone's login. Two copies of this rule
 * would eventually disagree, and the disagreement would look like a login
 * that exists but cannot sign in.
 */
export function normalizeLogin(raw: string): string {
  return raw.trim().toLowerCase();
}
