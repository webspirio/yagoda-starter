import { expect } from 'vitest';
import { axe } from 'vitest-axe';
import type { AxeResults, Result } from 'axe-core';

/**
 * Radix's focus guards, the one exemption here (2026-10-21), from `aria-hidden-focus`
 * alone. @radix-ui/react-focus-guards puts a `tabindex=0` span at each end of <body>,
 * then the dialog's `hideOthers` marks them `aria-hidden`; axe flags that pair. It
 * cannot see that a trapped FocusScope answers `focusin` outside the dialog by moving
 * focus straight back in, so a keyboard user never rests on a guard. test-axe.test.tsx
 * fails once Radix stops rendering them that way — delete this then.
 */
export const FOCUS_GUARD = '[data-radix-focus-guard]';

const isExempt = (rule: Result['id'], node: Result['nodes'][number]): boolean =>
  rule === 'aria-hidden-focus' && (node.element?.matches(FOCUS_GUARD) ?? false);

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
 *   - color-contrast and link-in-text-block are disabled: both judge colours,
 *     and no stylesheet loads in the test DOM. Under jsdom the first only
 *     emitted canvas warnings and the second was inapplicable to every link
 *     (no layout, so none looked visible); happy-dom computes no colour at all.
 * A green axe run means "no obvious markup defects", not "accessible".
 *
 * A rule axe could not RUN fails too. Under jsdom, which has no elementFromPoint,
 * `aria-hidden-focus` errored into `incomplete` on every call and this passed
 * without it ever having been checked.
 */
export async function expectNoAxeViolations(container: HTMLElement): Promise<void> {
  const results = (await axe(container, {
    rules: { 'color-contrast': { enabled: false }, 'link-in-text-block': { enabled: false } },
    elementRef: true,
  })) as AxeResults;

  const violations = results.violations
    .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !isExempt(v.id, n)) }))
    .filter((v) => v.nodes.length > 0);
  const summary = violations.map(
    (v) =>
      `[${v.impact}] ${v.id}: ${v.help}\n` + v.nodes.map((n) => `      ${n.html}`).join('\n'),
  );
  const errored = results.incomplete
    .filter((r) =>
      r.nodes.some((n) => [...n.any, ...n.all, ...n.none].some((c) => c.id === 'error-occurred')),
    )
    .map((r) => `${r.id}: axe could not run this rule here`);

  expect([...summary, ...errored], [...summary, ...errored].join('\n\n')).toEqual([]);
}
