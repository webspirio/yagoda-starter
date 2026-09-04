import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Segmented } from './segmented';

const opts = [
  { value: 'a', label: 'ДОВГИЙ' },
  { value: 'b', label: 'EN' },
];

describe('Segmented fit prop', () => {
  it('defaults to fill: segments grow equally and clip labels', () => {
    render(<Segmented options={opts} value="a" onChange={vi.fn()} label="test" />);
    const radio = screen.getByRole('radio', { name: 'ДОВГИЙ' });
    expect(radio.className).toContain('flex-1');
    // the label span truncates in fill mode
    expect(radio.querySelector('span.truncate')).not.toBeNull();
  });

  it('fit="content": segments size to content and do not truncate', () => {
    render(<Segmented options={opts} value="a" onChange={vi.fn()} label="test" fit="content" />);
    const radio = screen.getByRole('radio', { name: 'ДОВГИЙ' });
    expect(radio.className).toContain('flex-none');
    expect(radio.className).not.toContain('flex-1');
    expect(radio.querySelector('span.truncate')).toBeNull();
  });
});

describe('Segmented tone prop', () => {
  it('defaults to the muted tone: inactive labels are text-muted-foreground', () => {
    render(<Segmented options={opts} value="a" onChange={vi.fn()} label="test" />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('data-tone', 'default');
    const inactive = screen.getByRole('radio', { name: 'EN' });
    expect(inactive.className).toContain('text-muted-foreground');
  });

  it('tone="strong": readable inactive labels + a bolder active label', () => {
    render(<Segmented options={opts} value="a" onChange={vi.fn()} label="test" tone="strong" />);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('data-tone', 'strong');

    const active = screen.getByRole('radio', { name: 'ДОВГИЙ' });
    const inactive = screen.getByRole('radio', { name: 'EN' });
    // Active segment reads as clearly selected, not a flat pill.
    expect(active.className).toContain('font-semibold');
    // Inactive labels are darkened (no longer the muted "disabled" grey).
    expect(inactive.className).toContain('text-foreground/70');
    expect(inactive.className).not.toContain('text-muted-foreground');
  });
});

const three = [
  { value: 'a', label: 'Один' },
  { value: 'b', label: 'Два' },
  { value: 'c', label: 'Три' },
];

describe('Segmented dividers', () => {
  it('renders one divider between each pair of segments (never before the first)', () => {
    const { container } = render(
      <Segmented options={three} value="a" onChange={vi.fn()} label="test" />,
    );
    expect(container.querySelectorAll('[data-slot="segmented-divider"]')).toHaveLength(2);
    const first = screen.getByRole('radio', { name: 'Один' });
    expect(first.querySelector('[data-slot="segmented-divider"]')).toBeNull();
  });

  it('hides the dividers either side of the active segment so none crosses the thumb', () => {
    render(<Segmented options={three} value="b" onChange={vi.fn()} label="test" />);
    // 'b' is active: its own leading divider and the one leading 'c' are hidden.
    const b = screen.getByRole('radio', { name: 'Два' });
    const c = screen.getByRole('radio', { name: 'Три' });
    expect(b.querySelector('[data-slot="segmented-divider"]')).toHaveClass('opacity-0');
    expect(c.querySelector('[data-slot="segmented-divider"]')).toHaveClass('opacity-0');
  });

  it('shows a divider that is not adjacent to the active segment', () => {
    render(<Segmented options={three} value="a" onChange={vi.fn()} label="test" />);
    // 'a' is active (index 0): the divider leading 'c' is two away, so it shows.
    const c = screen.getByRole('radio', { name: 'Три' });
    expect(c.querySelector('[data-slot="segmented-divider"]')).not.toHaveClass('opacity-0');
  });

  // The control paints its own field with `bg-muted`, so the divider must use a
  // token that contrasts with THAT. `bg-border` — the obvious "hairline
  // dividers" token — is calibrated against --card and is the same hex as
  // --muted in dark mode, making the divider invisible there. See the paired
  // token assertions in brand-tokens.contrast.test.ts.
  it('draws the divider in a token that contrasts with the control field, not bg-border', () => {
    render(<Segmented options={three} value="a" onChange={vi.fn()} label="test" />);
    const divider = screen
      .getByRole('radio', { name: 'Три' })
      .querySelector('[data-slot="segmented-divider"]');
    expect(divider).toHaveClass('bg-line2');
    expect(divider).not.toHaveClass('bg-border');
  });

  it('keeps dividers out of the accessible name and out of the truncation check', () => {
    render(<Segmented options={three} value="a" onChange={vi.fn()} label="test" fit="content" />);
    const c = screen.getByRole('radio', { name: 'Три' });
    expect(c.textContent).toBe('Три');
    expect(c.querySelector('[data-slot="segmented-divider"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(c.querySelector('span.truncate')).toBeNull();
  });
});
