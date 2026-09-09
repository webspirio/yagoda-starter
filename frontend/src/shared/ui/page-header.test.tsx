import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { PageHeader } from './page-header';

it('renders the title as an h1 and the optional eyebrow + description', () => {
  render(<PageHeader eyebrow="Каса" title="Каса за день" description="Опис" />);
  expect(screen.getByRole('heading', { level: 1, name: 'Каса за день' })).toBeInTheDocument();
  expect(screen.getByText('Каса')).toBeInTheDocument();
  expect(screen.getByText('Опис')).toBeInTheDocument();
});

it('has no axe violations', async () => {
  const { container } = render(<PageHeader title="Каса за день" />);
  await expectNoAxeViolations(container);
});
