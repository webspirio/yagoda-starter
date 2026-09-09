import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { LedgerRow } from './ledger-row';

it('renders the label and value', () => {
  render(<LedgerRow label="За ягоду" value="1 616,10 ₴" />);
  expect(screen.getByText('За ягоду')).toBeInTheDocument();
  expect(screen.getByText('1 616,10 ₴')).toHaveClass('font-mono');
});

it('emphasises a strong (totals) row', () => {
  render(<LedgerRow label="Разом" value="15 416,10 ₴" strong />);
  expect(screen.getByText('15 416,10 ₴')).toHaveClass('font-semibold');
});

it('colours the value for a bad tone', () => {
  render(<LedgerRow label="Недостача" value="-120,00 ₴" tone="bad" />);
  expect(screen.getByText('-120,00 ₴')).toHaveClass('text-destructive');
});

it('has no axe violations', async () => {
  const { container } = render(<LedgerRow label="За ягоду" value="1 616,10 ₴" hint="сьогодні" />);
  await expectNoAxeViolations(container);
});
