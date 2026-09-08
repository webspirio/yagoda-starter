import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../test-axe';
import { DateStepper } from './date-stepper';

it('fires prev / next / today callbacks', async () => {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const onToday = vi.fn();
  render(
    <DateStepper label="04.08.2026" onPrev={onPrev} onNext={onNext} onToday={onToday} />,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Попередній день' }));
  await userEvent.click(screen.getByRole('button', { name: 'Наступний день' }));
  await userEvent.click(screen.getByRole('button', { name: 'Сьогодні' }));
  expect(onPrev).toHaveBeenCalledTimes(1);
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(onToday).toHaveBeenCalledTimes(1);
});

it('disables next when canNext is false', () => {
  render(<DateStepper label="04.08.2026" onPrev={vi.fn()} onNext={vi.fn()} canNext={false} />);
  expect(screen.getByRole('button', { name: 'Наступний день' })).toBeDisabled();
});

it('has no axe violations', async () => {
  const { container } = render(
    <DateStepper label="04.08.2026" onPrev={vi.fn()} onNext={vi.fn()} onToday={vi.fn()} />,
  );
  await expectNoAxeViolations(container);
});
