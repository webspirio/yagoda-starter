import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MultiSelectChips } from './multi-select-chips';

// Spelled out rather than derived via `React.ComponentProps<typeof
// MultiSelectChips>`: the component is generic, so that helper resolves `T` to
// its constraint and the inferred props fight every `overrides` value.
interface Props {
  options: { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
  allLabel: string;
  className?: string;
  chipClassName?: string;
}

const OPTIONS: Props['options'] = [
  { key: 'offline', label: 'Офлайн' },
  { key: 'online', label: 'Онлайн' },
  { key: 'offsite', label: 'Виїзд' },
];

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    options: OPTIONS,
    selected: [],
    onToggle: vi.fn(),
    onClear: vi.fn(),
    allLabel: 'Усі',
    ...overrides,
  };
  render(<MultiSelectChips {...props} />);
  return props;
}

describe('MultiSelectChips', () => {
  it('lights «Усі» exactly when the set is empty', () => {
    setup({ selected: [] });
    expect(screen.getByText('Усі')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Офлайн')).toHaveAttribute('aria-pressed', 'false');
  });

  it('unlights «Усі» once anything concrete is selected', () => {
    setup({ selected: ['offline'] });
    expect(screen.getByText('Усі')).toHaveAttribute('aria-pressed', 'false');
  });

  // The whole point of the component: more than one chip lit at a time.
  it('lights every selected chip at once', () => {
    setup({ selected: ['offline', 'online'] });
    expect(screen.getByText('Офлайн')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Онлайн')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Виїзд')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToggle with the tapped key', async () => {
    const props = setup();
    await userEvent.click(screen.getByText('Онлайн'));
    expect(props.onToggle).toHaveBeenCalledWith('online');
  });

  // Removal is the parent's job (`toggle`), so a lit chip reports the same
  // event as an unlit one — the component holds no state of its own.
  it('calls onToggle when re-tapping an already-lit chip', async () => {
    const props = setup({ selected: ['online'] });
    await userEvent.click(screen.getByText('Онлайн'));
    expect(props.onToggle).toHaveBeenCalledWith('online');
  });

  it('calls onClear from the «Усі» chip', async () => {
    const props = setup({ selected: ['offline', 'online'] });
    await userEvent.click(screen.getByText('Усі'));
    expect(props.onClear).toHaveBeenCalled();
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('applies the caller layout classes', () => {
    const { container } = render(
      <MultiSelectChips
        options={OPTIONS}
        selected={[]}
        onToggle={vi.fn()}
        onClear={vi.fn()}
        allLabel="Усі"
        className="flex-wrap"
        chipClassName="h-11"
      />,
    );
    expect(container.firstChild).toHaveClass('flex-wrap');
    expect(screen.getByText('Усі')).toHaveClass('h-11');
  });

  // `shrink-0` is not this component's call — it's per-call-site layout (one
  // filter row scrolls and wants it, another wraps and never had it), so
  // the component must pass `chipClassName` through unmodified rather than
  // hardcoding shrink-0 onto every chip.
  it('does not force shrink-0 onto chips absent from chipClassName', () => {
    setup({ chipClassName: undefined });
    expect(screen.getByText('Усі')).not.toHaveClass('shrink-0');
    expect(screen.getByText('Офлайн')).not.toHaveClass('shrink-0');
  });
});
