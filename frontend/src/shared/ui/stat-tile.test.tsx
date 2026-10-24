import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { StatTile } from './stat-tile';

it('renders the label, value and hint', () => {
  render(<StatTile label="У шухляді" value="15 416,10 ₴" hint="на ранок" />);
  expect(screen.getByText('У шухляді')).toBeInTheDocument();
  expect(screen.getByText('15 416,10 ₴')).toHaveClass('font-mono');
  expect(screen.getByText('на ранок')).toBeInTheDocument();
});

it('applies the tone colour to the value', () => {
  render(<StatTile label="За ягоду" value="1 616,10 ₴" tone="berry" />);
  // Berry TEXT is `text-brand` (the lightened berry in dark mode), never the fill.
  expect(screen.getByText('1 616,10 ₴')).toHaveClass('text-brand');
});

it('wears the one outlined shell, like Card', () => {
  render(<StatTile label="X" value="1" />);
  const tile = screen.getByText('X').closest('[data-slot="stat-tile"]');
  expect(tile).toHaveClass('border', 'border-line2');
  expect(tile?.className).not.toContain('ring-');
});

it('renders an icon when given one', () => {
  render(<StatTile label="X" value="1" icon={<svg data-testid="ic" />} />);
  expect(screen.getByTestId('ic')).toBeInTheDocument();
});

it('has no axe violations', async () => {
  const { container } = render(<StatTile label="У шухляді" value="1" hint="на ранок" />);
  await expectNoAxeViolations(container);
});
