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

/**
 * Why other "name" fields (a collection point's `name`, a person's
 * `first_name`/`last_name`) trim but deliberately do NOT lowercase, unlike a
 * login: a login is an identifier — never rendered, only matched — so folding
 * case removes a distinction nobody needed and closes off "Оксана"/"оксана"
 * ever meaning two accounts. A point name or a person's name is a DISPLAY
 * value; lowercasing it would rewrite what someone typed on every save
 * ("Копайгород" → "копайгород"), which is not normalization, it's data loss.
 * Trimming is still correct there — " dupe-check " and "dupe-check" render
 * identically and must collide under the same UNIQUE constraint — so trim
 * without lowercasing is the rule for every display-value column with a
 * uniqueness or readability concern. Decided once here so the next table
 * doesn't have to re-derive it.
 */
