import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { SectionCard } from './section-card';

it('renders eyebrow, title, aside and children', () => {
  render(
    <SectionCard eyebrow="Розділ" title="Каса" aside={<span>Усі →</span>}>
      <p>вміст</p>
    </SectionCard>,
  );
  expect(screen.getByText('Розділ')).toBeInTheDocument();
  expect(screen.getByText('Каса')).toBeInTheDocument();
  expect(screen.getByText('Усі →')).toBeInTheDocument();
  expect(screen.getByText('вміст')).toBeInTheDocument();
});

it('omits the card shell when card=false', () => {
  const { container } = render(
    <SectionCard card={false}>
      <p>bare</p>
    </SectionCard>,
  );
  expect((container.firstChild as HTMLElement).className).not.toContain('bg-card');
});

it('has no axe violations', async () => {
  const { container } = render(
    <SectionCard eyebrow="Розділ" title="Каса">
      <p>вміст</p>
    </SectionCard>,
  );
  await expectNoAxeViolations(container);
});
