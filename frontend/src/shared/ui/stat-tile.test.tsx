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
  expect(screen.getByText('1 616,10 ₴')).toHaveClass('text-primary');
});

it('renders an icon when given one', () => {
  render(<StatTile label="X" value="1" icon={<svg data-testid="ic" />} />);
  expect(screen.getByTestId('ic')).toBeInTheDocument();
});

it('has no axe violations', async () => {
  const { container } = render(<StatTile label="У шухляді" value="1" hint="на ранок" />);
  await expectNoAxeViolations(container);
});
