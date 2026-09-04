import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './card';

it('renders children on a card surface', () => {
  render(<Card>content</Card>);
  expect(screen.getByText('content')).toHaveClass(
    'rounded-2xl',
    'border',
    'border-border',
    'bg-card',
  );
});

it('lets className override the border token (twMerge last-wins)', () => {
  render(<Card className="border-line2 p-5">content</Card>);
  const el = screen.getByText('content');
  expect(el).toHaveClass('border-line2', 'p-5');
  expect(el).not.toHaveClass('border-border');
});

it('forwards arbitrary div props and data-slot', () => {
  render(
    <Card data-testid="x" role="group">
      content
    </Card>,
  );
  const el = screen.getByTestId('x');
  expect(el).toHaveAttribute('role', 'group');
  expect(el).toHaveAttribute('data-slot', 'card');
});
