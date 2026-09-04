import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button';

it('default variant is a primary FILL (bright orange + near-black foreground)', () => {
  render(<Button>Go</Button>);
  const btn = screen.getByRole('button', { name: 'Go' });
  expect(btn).toHaveClass('bg-primary', 'text-primary-foreground');
});

it('link variant is brand INK, never primary text', () => {
  render(<Button variant="link">More</Button>);
  const btn = screen.getByRole('button', { name: 'More' });
  expect(btn).toHaveClass('text-brand');
  expect(btn).not.toHaveClass('text-primary');
});
