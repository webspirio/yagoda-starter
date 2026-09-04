import { Chip } from '@/shared/ui/chip';
import { cn } from '@/shared/lib/cn';

interface ChipOption<T extends string> {
  key: T;
  label: string;
}

interface MultiSelectChipsProps<T extends string> {
  options: ChipOption<T>[];
  /** Selected keys. Empty means "no narrowing" — which is exactly what lights the "All" chip. */
  selected: T[];
  onToggle: (key: T) => void;
  onClear: () => void;
  /** Leading "no narrowing" chip's label ("All" / "All categories"). */
  allLabel: string;
  /** Container layout. A scrolling row and a wrapping row are both common. */
  className?: string;
  /** Per-chip layout, when one row's chips need to differ in height from another's. */
  chipClassName?: string;
  /**
   * Disables every chip (including "All") without hiding them. For a group
   * whose default is derived from data not yet loaded, a tap during that
   * window would toggle against an empty `selected` set and silently discard
   * the real default once it resolves.
   */
  disabled?: boolean;
}

/**
 * A chip group where any number of options can be lit at once, fronted by an
 * "All" chip that is lit exactly when nothing else is and clears the set
 * when tapped. Holding no state of its own, it reports taps and renders
 * whatever `selected` it is handed.
 *
 * `Chip`'s default `aria-pressed` is the correct semantics here — these are
 * independent toggles, not a radio group, which is what a single-select
 * predecessor would be pretending to be.
 *
 * The two layout props exist because different call sites can differ in
 * nothing *but* layout, and their classes live at different levels: the
 * scroll/wrap behaviour is on the container, the chip height is on each chip.
 */
export function MultiSelectChips<T extends string>({
  options,
  selected,
  onToggle,
  onClear,
  allLabel,
  className,
  chipClassName,
  disabled,
}: MultiSelectChipsProps<T>) {
  return (
    <div className={className}>
      <Chip
        selected={selected.length === 0}
        onClick={onClear}
        className={cn(chipClassName)}
        disabled={disabled}
      >
        {allLabel}
      </Chip>
      {options.map((option) => (
        <Chip
          key={option.key}
          selected={selected.includes(option.key)}
          onClick={() => onToggle(option.key)}
          className={cn(chipClassName)}
          disabled={disabled}
        >
          {option.label}
        </Chip>
      ))}
    </div>
  );
}
