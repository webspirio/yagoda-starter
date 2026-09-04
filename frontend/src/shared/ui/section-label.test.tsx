import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionLabel } from './section-label';

it('renders a span with the eyebrow classes by default', () => {
  render(<SectionLabel>Interests</SectionLabel>);
  const el = screen.getByText('Interests');
  expect(el.tagName).toBe('SPAN');
  expect(el).toHaveClass(
    'text-xs',
    'font-bold',
    'uppercase',
    'tracking-wider',
    'text-muted-foreground',
  );
});

it('honors the `as` element (heading semantics survive)', () => {
  render(<SectionLabel as="h2">About</SectionLabel>);
  expect(screen.getByText('About').tagName).toBe('H2');
});

it('lets className override the text size (twMerge)', () => {
  render(<SectionLabel className="text-[11px]">X</SectionLabel>);
  const el = screen.getByText('X');
  expect(el).toHaveClass('text-[11px]');
  expect(el).not.toHaveClass('text-xs');
});
