import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FieldA11y } from './field';
import { TextInput } from './text-input';
import { Chip } from './chip';

export interface TagOption { value: string; label: string; }

interface TagPickerProps extends Partial<FieldA11y> {
  value: string[];
  onChange: (value: string[]) => void;
  options: readonly TagOption[];
  placeholder?: string;
  /** Dictionary options shown while collapsed, before "show all" is expanded. */
  visibleCount?: number;
  /** Allow adding a free-text value not present in `options`. */
  allowCreate?: boolean;
  /** When false, hide the free-text search box. The `Field` a11y id/label then
   *  ride on the chip group so label association + focus-first-invalid still work. */
  searchable?: boolean;
  /** Anchor a single option (e.g. the user's primary choice) first, bold, and
   *  non-toggleable. Ignored when unset or not present in `options`. */
  pinnedValue?: string;
  /** Disables the search input and every interactive chip (option, free-text,
   *  create) via the native `disabled` attribute — blocks click *and* keyboard
   *  activation, unlike a CSS-only dim. The pinned chip is already
   *  non-interactive (no `onClick`), so it's unaffected. Default false. */
  disabled?: boolean;
}

/**
 * Searchable multi-select chips. Dictionary options render in natural order and
 * toggle selected IN PLACE — selecting one never reorders the list. Overflow
 * past `visibleCount` collapses behind a "show all / collapse" toggle that
 * never hides a selected option. Free-text ("create") values live outside the
 * dictionary, so they render as their own always-visible, removable group.
 * The stored value is the option's `value` (a stable key); `label` is shown and
 * searched. Free-text values store `value === label`.
 */
export function TagPicker({
  value, onChange, options, placeholder, visibleCount = 8, allowCreate = true, searchable = true, pinnedValue, disabled, ...a11y
}: TagPickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const q = query.trim().toLowerCase();

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const inOptions = (v: string) => options.some((o) => o.value === v);
  const selectedSet = new Set(value);
  const searching = q !== '';

  // Pinned anchor (e.g. the user's primary choice): first, bold, non-toggleable, and
  // excluded from the toggleable list so it never appears twice. Purely presentational —
  // derived from the prop, it never reads or writes `value`/`onChange`.
  const pinnedOption = pinnedValue ? options.find((o) => o.value === pinnedValue) : undefined;
  const listOptions = pinnedOption ? options.filter((o) => o.value !== pinnedValue) : options;

  // Free-text selections (not in the dictionary) always render — otherwise they
  // would be invisible and un-removable. Filtered by the query while searching.
  //
  // Guard: only a dictionary that opts into free text (`allowCreate`) can have
  // legitimate off-dictionary values. When `allowCreate === false`, an unknown
  // selected value is never user-created — it's a stale/not-yet-loaded reference
  // (e.g. a city UUID selected before `options` finished fetching). Rendering it
  // verbatim would leak a raw UUID as a chip, so suppress it instead.
  const freeText = allowCreate ? value.filter((v) => !inOptions(v)) : [];
  const shownFreeText = searching ? freeText.filter((v) => v.toLowerCase().includes(q)) : freeText;

  // Dictionary options in natural order; a search shows all matches (cap bypassed).
  const filtered = searching ? listOptions.filter((o) => o.label.toLowerCase().includes(q)) : listOptions;
  const visibleOptions = (() => {
    if (searching || expanded) return filtered;
    const head = filtered.slice(0, visibleCount);
    const selectedTail = filtered.slice(visibleCount).filter((o) => selectedSet.has(o.value));
    return [...head, ...selectedTail]; // natural order preserved; a selection is never hidden
  })();

  const hiddenUnselected =
    searching || expanded ? 0 : filtered.slice(visibleCount).filter((o) => !selectedSet.has(o.value)).length;

  const canCreate =
    allowCreate && q !== '' &&
    !options.some((o) => o.label.toLowerCase() === q) &&
    !value.some((v) => labelOf(v).toLowerCase() === q);

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const create = () => {
    const label = query.trim();
    if (label && !value.some((v) => labelOf(v).toLowerCase() === label.toLowerCase())) {
      onChange([...value, label]); // free-text: value === label
    }
    setQuery('');
  };

  return (
    <div>
      {searchable && (
        <TextInput
          {...a11y}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder ?? t('picker.searchPlaceholder')}
          autoComplete="off"
          disabled={disabled}
        />
      )}
      <div
        {...(searchable ? {} : { ...a11y, role: 'group', tabIndex: -1 })}
        className={searchable ? 'mt-2.5 flex flex-wrap gap-[7px]' : 'flex flex-wrap gap-[7px]'}
      >
        {pinnedOption && (
          <Chip key={pinnedOption.value} selected aria-disabled="true" className="font-bold">
            {pinnedOption.label}
          </Chip>
        )}
        {shownFreeText.map((v) => (
          <Chip key={v} selected onClick={() => toggle(v)} disabled={disabled}>{v}</Chip>
        ))}
        {visibleOptions.map((o) => (
          <Chip
            key={o.value}
            selected={selectedSet.has(o.value)}
            onClick={() => toggle(o.value)}
            disabled={disabled}
          >
            {o.label}
          </Chip>
        ))}
        {canCreate && (
          <Chip variant="create" onClick={create} disabled={disabled}>
            {t('picker.create', { label: query.trim() })}
          </Chip>
        )}
      </div>
      {!searching && (hiddenUnselected > 0 || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1.5 text-xs font-semibold text-brand"
        >
          {expanded ? t('actions.collapse') : t('actions.showAll', { count: hiddenUnselected })}
        </button>
      )}
    </div>
  );
}
