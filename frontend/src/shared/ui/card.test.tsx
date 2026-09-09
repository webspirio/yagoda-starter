import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './card';

it('renders children on the outlined card surface', () => {
  render(<Card>content</Card>);
  expect(screen.getByText('content')).toHaveClass(
    'rounded-xl',
    'border',
    'border-line2',
    'bg-card',
    'overflow-hidden',
  );
});

it('lets className override the border token (twMerge last-wins)', () => {
  render(<Card className="border-border p-5">content</Card>);
  const el = screen.getByText('content');
  expect(el).toHaveClass('border-border', 'p-5');
  expect(el).not.toHaveClass('border-line2');
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
