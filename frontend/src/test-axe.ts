import { expect } from 'vitest';
import { axe } from 'vitest-axe';
import type { AxeResults } from 'axe-core';

/**
 * Asserts a rendered container has no machine-detectable a11y violations.
 *
 * SCOPE — read before trusting a green run. axe only sees what is decidable
 * from the DOM, and this suite measured its blind spots directly:
 *   - it does NOT catch a <label> that points at nothing (an input with a
 *     placeholder still has an accessible name) — Field's required `name` prop
 *     makes that a compile error instead;
 *   - it does NOT catch a missing aria-describedby to an error message —
 *     shared/ui/field.test.tsx covers that explicitly;
 *   - color-contrast is disabled: no stylesheet loads under jsdom, so the rule
 *     is meaningless here and only emits canvas warnings.
 * A green axe run means "no obvious markup defects", not "accessible".
 */
export async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = (await axe(container, {
    rules: { 'color-contrast': { enabled: false } },
  })) as AxeResults;

  const summary = results.violations.map(
    (v) =>
      `[${v.impact}] ${v.id}: ${v.help}\n` + v.nodes.map((n) => `      ${n.html}`).join('\n'),
  );

  expect(summary, summary.join('\n\n')).toEqual([]);
}
