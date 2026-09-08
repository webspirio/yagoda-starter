import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { EmptyState } from './empty-state';

it('renders the title and optional hint', () => {
  render(<EmptyState title="Порожньо" hint="Ще нічого не додано" />);
  expect(screen.getByText('Порожньо')).toBeInTheDocument();
  expect(screen.getByText('Ще нічого не додано')).toBeInTheDocument();
});

it('has no axe violations', async () => {
  const { container } = render(<EmptyState title="Порожньо" hint="Ще нічого не додано" />);
  await expectNoAxeViolations(container);
});
