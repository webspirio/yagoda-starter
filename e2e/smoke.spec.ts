import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

/**
 * `smoke` (root CLAUDE.md's verify table, tier `full`) — the one row in this repo's
 * verify layer that drives a real browser against the real compose stack. Exactly
 * three assertions, on purpose (see this file's own header on each): this row proves
 * the pieces COMPOSE, it is not a test suite for any one screen.
 *
 * blindSpot, stated here rather than only in the registry, because a reader of this
 * file is exactly the person most likely to mistake a green run for more than it is:
 *  - Exercises ONE path through the app — sign in, land on the dashboard, read one
 *    stat tile. It says nothing about any other screen, any other role, any other
 *    flow.
 *  - Runs against SEEDED data (`npm run db:seed`'s fixed demo dataset), never
 *    real-world data shapes, volumes, or edge cases.
 *  - A pass here means the stack COMPOSES — the frontend, the backend, Postgres,
 *    Redis and the browser all agree on how to talk to each other. It says nothing
 *    about whether any business rule (§-numbered or otherwise) is actually correct.
 */

const { username, password } = JSON.parse(
  readFileSync(path.join(__dirname, '.auth', 'owner.json'), 'utf8'),
) as { username: string; password: string };

// Ukrainian ('uk') is this app's default locale for a session with nothing in
// localStorage yet (frontend/src/shared/lib/i18n/index.ts's `detectLanguage()`), which
// is exactly the state a fresh Playwright browser context starts in — no auto-detection
// from the browser's own Accept-Language. These are read straight out of
// frontend/src/shared/lib/i18n/locales/uk.json, not re-derived, so a copy change there
// breaks this spec visibly rather than this spec silently drifting from what a real user
// sees.
const T = {
  signIn: 'Увійти',
  username: 'Логін',
  password: 'Пароль',
  dashboardTitle: 'Зведення',
  receiptsTileLabel: 'Квитанцій сьогодні',
};

test('signs in as the seeded owner and reaches a dashboard built from real seed data', async ({
  page,
}) => {
  // Assertion 3 straddles the whole run, so the listeners go on before the first
  // navigation, not just around the parts that "look risky". They also back up
  // assertions 1 and 2 below: whichever fails first gets these attached to its own
  // failure message (see the `catch` at the bottom) — the real cause (a network request
  // that never completed) is otherwise easy to lose behind a generic "element not
  // found", which is exactly the confusing-months-from-now failure this row is trying
  // hardest not to produce.
  const pageErrors: Error[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
  });

  const diagnostics = (): string =>
    [
      pageErrors.length ? `Uncaught page error(s):\n${pageErrors.map(String).join('\n')}` : '',
      failedRequests.length ? `Failed network request(s):\n${failedRequests.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  try {
    // --- Assertion 1: the sign-in page renders, and signing in through the UI with the
    // seeded owner's real credentials reaches the dashboard. ---
    await page.goto('/');
    await expect(page.getByRole('heading', { name: T.signIn })).toBeVisible();

    await page.getByLabel(T.username, { exact: true }).fill(username);
    await page.getByLabel(T.password, { exact: true }).fill(password);
    await page.getByRole('button', { name: T.signIn }).click();

    await expect(page.getByRole('heading', { name: T.dashboardTitle })).toBeVisible();

    // --- Assertion 2: a page requiring data renders a number that came from the seed —
    // not NaN, not an empty state. The dashboard's "Квитанцій сьогодні" (receipts
    // today) stat tile is `String(totalReceipts)` (frontend/src/pages/dashboard/ui/
    // DashboardPage.tsx), a plain integer with no currency formatting to parse around —
    // and `npm run db:seed` seeds real receipts on open shifts dated today
    // (backend/CLAUDE.md's Dev seed section), so a correctly composed stack renders a
    // positive count here, not zero (an empty state in substance, even though it isn't
    // literally NaN) and not a crash.
    const receiptsTile = page
      .locator('[data-slot="stat-tile"]')
      .filter({ hasText: T.receiptsTileLabel });
    await expect(receiptsTile).toBeVisible();
    const rawValue = (await receiptsTile.locator('div.font-mono').textContent())?.trim() ?? '';
    const receiptsCount = Number(rawValue);
    expect(rawValue, 'receipts tile rendered no value at all').not.toBe('');
    expect(
      Number.isNaN(receiptsCount),
      `receipts tile rendered a non-numeric value: "${rawValue}"`,
    ).toBe(false);
    expect(
      receiptsCount,
      'receipts tile rendered zero — indistinguishable from an empty state',
    ).toBeGreaterThan(0);
  } catch (error) {
    const context = diagnostics();
    if (!context) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n\n--- captured during this run ---\n${context}`);
  }

  // --- Assertion 3: no uncaught page error and no failed network request anywhere
  // during the run. Checked last and unconditionally: assertions 1 and 2 can both pass
  // (the app can recover from, or never notice, something that still fired one of these
  // events) while this one alone catches it. ---
  expect(pageErrors, `uncaught page error(s):\n${pageErrors.map(String).join('\n')}`).toHaveLength(0);
  expect(failedRequests, `failed network request(s):\n${failedRequests.join('\n')}`).toHaveLength(0);
});
