import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SelectField } from './select-field';

// Audit 2026-10-24, F3: a width given to the select (`w-44`) left the wrapper full width,
// so the chevron — positioned on the wrapper — floated away from the box.
it('gives the box size to the wrapper, so the chevron sits inside the select', () => {
  render(
    <SelectField aria-label="Точка" className="mt-1 h-10 w-44">
      <option>A</option>
    </SelectField>,
  );
  const select = screen.getByRole('combobox', { name: 'Точка' });
  const wrapper = select.parentElement!;
  expect(wrapper).toHaveAttribute('data-slot', 'select-field');
  expect(wrapper).toHaveClass('w-44', 'mt-1');
  expect(select).not.toHaveClass('w-44');
  expect(select).not.toHaveClass('mt-1');
  // The select fills its wrapper; its own look stays on it.
  expect(select).toHaveClass('w-full', 'h-10');
});

it('takes an explicit wrapperClassName', () => {
  render(
    <SelectField aria-label="Сорт" wrapperClassName="max-w-[320px]">
      <option>A</option>
    </SelectField>,
  );
  expect(screen.getByRole('combobox', { name: 'Сорт' }).parentElement).toHaveClass(
    'max-w-[320px]',
  );
});
