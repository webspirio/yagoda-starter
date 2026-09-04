import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import { TagPicker, type TagOption } from './TagPicker';

const OPTS: TagOption[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
];

/** 12-option pool (indices 0..11) for the expand/collapse + cap-overflow tests. */
const MANY: TagOption[] = Array.from({ length: 12 }, (_, i) => ({
  value: `opt${i}`,
  label: `Option ${i}`,
}));

/**
 * TagPicker is controlled — renderPicker drives it through a tiny stateful
 * wrapper so toggles reflect back into `value`, and returns the onChange spy
 * so callers can assert on it. Defaults to a 2-option pool; pass `options`
 * (e.g. the 3-option `OPTS`) where a test needs Gamma in the pool.
 */
function renderPicker({
  value: initialValue = [],
  options = [
    { value: 'alpha', label: 'Alpha' },
    { value: 'beta', label: 'Beta' },
  ],
  ...rest
}: Partial<Omit<ComponentProps<typeof TagPicker>, 'onChange'>> = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState<string[]>(initialValue);
    return (
      <TagPicker
        value={value}
        options={options}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        {...rest}
      />
    );
  }
  render(<Harness />);
  return onChange;
}

/** Accessible names of every rendered chip, in DOM order (the search input is a separate `textbox` role). */
function chipNames(): string[] {
  return screen.getAllByRole('button').map((el) => el.textContent ?? '');
}

describe('TagPicker', () => {
  it('selects an option on click and removes it on a second click', () => {
    const onChange = renderPicker();

    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenLastCalledWith(['beta']);
    // Beta stays in its natural position and just gains selected state —
    // never both a selected and a separate suggestion chip at once.
    expect(screen.getAllByRole('button', { name: 'Beta' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getAllByRole('button', { name: 'Beta' })).toHaveLength(1);
  });

  it('filters the suggestion pool by the query', () => {
    renderPicker({ options: OPTS });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'gam' } });
    expect(screen.getByRole('button', { name: 'Gamma' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument();
  });

  it('offers a create chip for a novel query and adds it via onChange', () => {
    const onChange = renderPicker();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Delta' } });
    // The starter's trimmed i18n resource (shared/lib/i18n/locales/en.json)
    // does not define a `picker.create` key, so i18next falls back to
    // rendering the raw key — a real app adding this key would see its own
    // copy here instead.
    const createChip = screen.getByRole('button', { name: 'picker.create' });
    fireEvent.click(createChip);

    expect(onChange).toHaveBeenCalledWith(['Delta']);
  });

  it('does not offer a create chip for an already-existing option (case-insensitive)', () => {
    renderPicker();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'alpha' } });
    expect(screen.queryByText(/Додати/)).not.toBeInTheDocument();
    // The existing option still shows up as a selectable suggestion.
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('does not offer a create chip when allowCreate is false', () => {
    renderPicker({ allowCreate: false });

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nowhere' } });
    expect(screen.queryByText(/Додати /)).not.toBeInTheDocument();
  });

  it('exposes selection state to assistive tech', () => {
    // Class-only selection is invisible to AT; aria-pressed is the signal.
    renderPicker({ value: ['beta'] });
    expect(screen.getByRole('button', { name: 'Beta', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alpha', pressed: false })).toBeInTheDocument();
  });

  it('keeps dictionary chips in a stable position when toggling selection', async () => {
    // visibleCount covers the whole pool and allowCreate is off, so the only
    // chips rendered are the three dictionary options — isolating the order
    // assertion from the collapse/create affordances.
    const user = userEvent.setup();
    renderPicker({ options: OPTS, visibleCount: OPTS.length, allowCreate: false });

    expect(chipNames()).toEqual(['Alpha', 'Beta', 'Gamma']);

    await user.click(screen.getByRole('button', { name: 'Beta' }));

    // Selecting the middle chip must not reorder the list — only its
    // selected state flips (this is the jump-to-top regression this ticket fixes).
    expect(chipNames()).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Alpha' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('collapses options past visibleCount behind an expand/collapse toggle', async () => {
    const user = userEvent.setup();
    renderPicker({ options: MANY, visibleCount: 8 });

    // Only the first 8 (natural order) render while collapsed.
    expect(screen.getByRole('button', { name: 'Option 7' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Option 8' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Option 11' })).not.toBeInTheDocument();

    // See the comment above the 'offers a create chip' test: the trimmed
    // i18n resource has no `actions.showAll`/`actions.collapse` key, so
    // i18next renders the raw key.
    await user.click(screen.getByRole('button', { name: 'actions.showAll' }));

    expect(screen.getByRole('button', { name: 'Option 8' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Option 11' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'actions.collapse' }));

    expect(screen.queryByRole('button', { name: 'Option 8' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Option 7' })).toBeInTheDocument();
  });

  it('never hides a selected option past the cap, even while collapsed', () => {
    renderPicker({ options: MANY, visibleCount: 8, value: ['opt11'] });

    expect(screen.getByRole('button', { name: 'Option 11', pressed: true })).toBeInTheDocument();
  });

  it('renders a free-text selection as its own always-visible, removable chip', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker({ options: OPTS, value: ['Delta'] });

    // "Delta" isn't in OPTS, so it can only be showing via the free-text group.
    const chip = screen.getByRole('button', { name: 'Delta' });
    expect(chip).toBeInTheDocument();

    await user.click(chip);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('does not leak an unknown selected value as a raw chip when allowCreate is false', () => {
    // With allowCreate off there is no legitimate off-dictionary value — an
    // unknown selection is a stale/not-yet-loaded reference (e.g. a city UUID
    // selected before `options` finished fetching). It must be suppressed, not
    // rendered verbatim as a chip.
    renderPicker({
      options: OPTS,
      value: ['550e8400-e29b-41d4-a716-446655440000'],
      allowCreate: false,
    });

    expect(
      screen.queryByRole('button', { name: '550e8400-e29b-41d4-a716-446655440000' }),
    ).not.toBeInTheDocument();
    // The real dictionary options still render as usual.
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
  });

  it('renders no search box when searchable is false', () => {
    renderPicker({ options: OPTS, searchable: false });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('still toggles chips when searchable is false', () => {
    const onChange = renderPicker({ options: OPTS, searchable: false });
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
    expect(onChange).toHaveBeenLastCalledWith(['beta']);
  });

  it('still collapses/expands overflow when searchable is false', async () => {
    const user = userEvent.setup();
    renderPicker({ options: MANY, visibleCount: 8, searchable: false });

    expect(screen.queryByRole('button', { name: 'Option 8' })).not.toBeInTheDocument();
    // See the comment above the 'offers a create chip' test: the trimmed
    // i18n resource has no `actions.showAll`/`actions.collapse` key, so
    // i18next renders the raw key.
    await user.click(screen.getByRole('button', { name: 'actions.showAll' }));
    expect(screen.getByRole('button', { name: 'Option 8' })).toBeInTheDocument();
  });

  it('exposes the chip group with the field id (focus target) when searchable is false', () => {
    renderPicker({ options: OPTS, searchable: false, id: 'cities' });
    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('id', 'cities');
    expect(group).toHaveAttribute('tabindex', '-1');
  });

  it('disables the search input and option chips when disabled', () => {
    renderPicker({ options: OPTS, disabled: true });
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeDisabled();
  });
});

const PINNED_OPTS: TagOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('TagPicker · pinnedValue', () => {
  it('renders the pinned option first, bold, aria-disabled, and non-toggleable', () => {
    const onChange = vi.fn();
    render(
      <TagPicker
        value={[]}
        onChange={onChange}
        options={PINNED_OPTS}
        pinnedValue="b"
        searchable={false}
        allowCreate={false}
      />,
    );
    const chips = screen.getAllByRole('button');
    expect(chips[0]).toHaveTextContent('Beta');
    expect(chips[0]).toHaveClass('font-bold');
    expect(chips[0]).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(chips[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not duplicate the pinned option in the toggleable list', () => {
    render(
      <TagPicker
        value={[]}
        onChange={vi.fn()}
        options={PINNED_OPTS}
        pinnedValue="b"
        searchable={false}
        allowCreate={false}
      />,
    );
    expect(screen.getAllByText('Beta')).toHaveLength(1);
  });

  it('renders nothing extra when pinnedValue is not in options', () => {
    render(
      <TagPicker
        value={[]}
        onChange={vi.fn()}
        options={PINNED_OPTS}
        pinnedValue="zzz"
        searchable={false}
        allowCreate={false}
      />,
    );
    expect(screen.queryByText('zzz')).not.toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('toggling a non-pinned option still emits normally', () => {
    const onChange = vi.fn();
    render(
      <TagPicker
        value={[]}
        onChange={onChange}
        options={PINNED_OPTS}
        pinnedValue="b"
        searchable={false}
        allowCreate={false}
      />,
    );
    fireEvent.click(screen.getByText('Alpha'));
    expect(onChange).toHaveBeenCalledWith(['a']);
  });
});
