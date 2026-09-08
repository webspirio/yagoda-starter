import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { Eyebrow } from './eyebrow';

it('renders its text with the eyebrow classes', () => {
  render(<Eyebrow>Разом</Eyebrow>);
  expect(screen.getByText('Разом')).toHaveClass('uppercase', 'text-muted-foreground');
});

it('has no axe violations', async () => {
  const { container } = render(<Eyebrow>Разом</Eyebrow>);
  await expectNoAxeViolations(container);
});
