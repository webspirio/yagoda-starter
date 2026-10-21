import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import type { AxeResults } from 'axe-core';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/dialog';
import { FOCUS_GUARD, expectNoAxeViolations } from './test-axe';

const openDialog = () =>
  render(
    <Dialog open>
      <DialogContent>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Description</DialogDescription>
      </DialogContent>
    </Dialog>,
  );

describe('expectNoAxeViolations', () => {
  const elementFromPoint = document.elementFromPoint;
  afterEach(() => {
    document.elementFromPoint = elementFromPoint;
  });

  it('still needs the focus-guard exemption: raw axe flags the guards and nothing else', async () => {
    openDialog();
    const raw = (await axe(document.body, {
      runOnly: ['aria-hidden-focus'],
      elementRef: true,
    })) as AxeResults;
    const flagged = raw.violations.flatMap((v) => v.nodes.map((n) => n.element));
    // Empty here means Radix no longer renders a focusable aria-hidden guard:
    // drop FOCUS_GUARD from test-axe.ts along with this test.
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((el) => el?.matches(FOCUS_GUARD))).toBe(true);
  });

  it('passes a dialog whose only finding is the guards', async () => {
    openDialog();
    await expectNoAxeViolations(document.body);
  });

  it('still fails a focusable aria-hidden element that is not a guard', async () => {
    const { container } = render(
      <div aria-hidden="true">
        <button type="button">Hidden but focusable</button>
      </div>,
    );
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/aria-hidden-focus/);
  });

  it('fails when axe could not run a rule, instead of passing without it', async () => {
    const { container } = render(
      <div aria-hidden="true">
        <button type="button">Hidden but focusable</button>
      </div>,
    );
    // What jsdom lacked: without it axe skips aria-hidden-focus into `incomplete`.
    document.elementFromPoint = undefined as unknown as typeof document.elementFromPoint;
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/could not run/);
  });
});
