import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { ChevronsUpDown, Plus, TriangleAlert, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { TextInput } from '@/shared/ui/text-input';
import { cn } from '@/shared/lib/cn';
import { cmp, formatUah } from '@/shared/lib/money';
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import {
  KindBadge,
  kindHintKey,
  supplierName,
  useSupplierBalancesQuery,
  useSuppliersQuery,
  type Supplier,
} from '@/entities/supplier';
// Same-layer import (features -> features): the spec requires inline creation
// of a supplier from inside the picker's own «Додати нового постачальника»
// footer, so it stays here rather than being lifted to widgets/. ESLint's
// FSD rule only checks import DIRECTION, so this lints clean; flag it in
// review if the coupling ever grows past this one dialog.
import { SupplierFormDialog } from '@/features/edit-supplier';

export interface SupplierPickerHandle {
  focus(): void;
}

/**
 * §2.1 step ① as the mock draws it: one button that reads like a field, a
 * search box the moment it opens, every person on one list with their marker
 * (§2.11) and what is still owed to them, and «Додати нового постачальника»
 * at the bottom so a first-time visitor never sends the operator to another
 * screen. Built on plain DOM roles rather than a popover library: the bundle
 * budget has no room for one, and a listbox is small.
 */
export const SupplierPicker = forwardRef<
  SupplierPickerHandle,
  {
    /** The point the visit is at (owner's pick, or the operator's own — may be null while resolving). */
    pointId: string | null;
    /** Owner mode groups «Наша точка» / «Інші точки» by collection_point_id === pointId. */
    ownerMode: boolean;
    value: Supplier | null;
    onChange: (supplier: Supplier) => void;
    disabled?: boolean;
    /** Autofocus the TRIGGER on mount — the caller's call, made only while no
     *  supplier is chosen yet (see `SupplierSection`). */
    autoFocus?: boolean;
  }
>(function SupplierPicker({ pointId, ownerMode, value, onChange, disabled, autoFocus }, ref) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => triggerRef.current?.focus() }));

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // -1 = nothing highlighted yet. The panel opens with no option pre-selected;
  // the first ArrowDown lands on index 0 rather than skipping past it.
  const [active, setActive] = useState(-1);
  const [addOpen, setAddOpen] = useState(false);
  const debounced = useDebouncedValue(search);

  const suppliers = useSuppliersQuery(debounced, ownerMode ? null : pointId);
  // An owner with no point chosen yet must not fetch an unscoped (network-wide)
  // balances list just to populate a picker nobody can use yet.
  const balances = useSupplierBalancesQuery({
    pointId,
    includeZero: false,
    enabled: pointId !== null,
  });
  const owed = new Map((balances.data?.data ?? []).map((row) => [row.supplier_id, row.debt]));

  const rows = (suppliers.data?.data ?? []).filter((s) => s.is_active);
  const home = ownerMode ? rows.filter((s) => s.collection_point_id === pointId) : rows;
  const others = ownerMode ? rows.filter((s) => s.collection_point_id !== pointId) : [];
  const flat = [...home, ...others];
  const activeId = flat[active]?.id;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keeps the highlighted row inside the scrollable listbox as ArrowDown/Up
  // move `active` past what is currently visible — up to 100 rows can be
  // loaded against ~6 visible at a time. `scrollIntoView` isn't implemented
  // in jsdom, hence the typeof guard.
  useEffect(() => {
    if (!open || activeId === undefined) return;
    const el = document.getElementById(`${id}-opt-${activeId}`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [active, open, activeId, id]);

  const selectSupplier = (s: Supplier) => {
    onChange(s);
    setOpen(false);
    setSearch('');
    setActive(-1);
  };

  const pick = (s: Supplier) => {
    selectSupplier(s);
    triggerRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // From "nothing highlighted" ArrowUp wraps to the LAST option (as if
      // approaching the list from the bottom), rather than landing on the
      // first the way a fresh ArrowDown would.
      setActive((a) => (a === -1 ? flat.length - 1 : Math.max(a - 1, 0)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[active]) pick(flat[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const hint = value ? kindHintKey(value.kind) : null;

  const renderRow = (s: Supplier, index: number) => {
    const debt = owed.get(s.id);
    return (
      <li
        key={s.id}
        id={`${id}-opt-${s.id}`}
        role="option"
        aria-selected={value?.id === s.id}
        className={cn(
          'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
          index === active && 'bg-muted',
        )}
        onMouseEnter={() => setActive(index)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => pick(s)}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate">{supplierName(s)}</span>
            <KindBadge kind={s.kind} className="shrink-0 text-[10px]" />
          </span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {s.phone ?? t('pickSupplier.noPhone')}
          </span>
        </span>
        {debt && cmp(debt, '0') === 1 ? (
          <span className="shrink-0 font-mono text-xs text-amber">{formatUah(debt, locale)}</span>
        ) : null}
      </li>
    );
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        autoFocus={autoFocus}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-list`}
        // role="combobox" takes its accessible name "from author" only (per the ARIA
        // name-computation spec, unlike a plain button it does NOT take a name from its
        // visible content), so axe's button-name check sees the icon-plus-text children
        // and reports an empty name without this — even though the text is right there.
        aria-label={
          value
            ? `${supplierName(value)} · ${value.phone ?? t('pickSupplier.noPhone')}`
            : t('pickSupplier.placeholder')
        }
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-12 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-base disabled:opacity-50"
      >
        {value ? (
          <span className="flex min-w-0 items-center gap-2">
            <UserRound className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{supplierName(value)}</span>
            <span className="hidden truncate font-mono text-sm text-muted-foreground sm:inline">
              {value.phone ?? t('pickSupplier.noPhone')}
            </span>
            <KindBadge kind={value.kind} className="shrink-0 text-[10px]" />
          </span>
        ) : (
          <span className="flex items-center gap-2 text-muted-foreground">
            <UserRound className="size-4" />
            {t('pickSupplier.placeholder')}
          </span>
        )}
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>

      {hint ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{t(hint)}</span>
        </p>
      ) : null}

      {open ? (
        <div
          className="absolute left-0 right-0 z-20 mt-1 rounded-xl border border-line2 bg-card shadow-lg"
          onKeyDown={onKey}
        >
          <div className="border-b border-border p-2">
            <TextInput
              role="searchbox"
              autoFocus
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setActive(-1);
              }}
              placeholder={t('pickSupplier.search')}
              aria-label={t('pickSupplier.search')}
              aria-controls={`${id}-list`}
              aria-activedescendant={flat[active] ? `${id}-opt-${flat[active].id}` : undefined}
            />
          </div>
          <ul id={`${id}-list`} role="listbox" className="max-h-[320px] overflow-y-auto py-1">
            {flat.length === 0 ? (
              // A non-presentational role so the listbox still satisfies "at least
              // one option/group child" (aria-required-children) even with zero
              // results — a disabled, unpickable option rather than plain text.
              <li
                role="option"
                aria-disabled="true"
                className="px-3 py-4 text-center text-sm text-muted-foreground"
              >
                {t('pickSupplier.empty')}
              </li>
            ) : null}
            {ownerMode ? (
              <>
                {home.length ? (
                  <li role="presentation">
                    <span className="block px-3 pt-2 pb-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                      {t('pickSupplier.ourPoint')}
                    </span>
                    <ul role="group" aria-label={t('pickSupplier.ourPoint')}>
                      {home.map((s, i) => renderRow(s, i))}
                    </ul>
                  </li>
                ) : null}
                {others.length ? (
                  <li role="presentation">
                    <span className="block px-3 pt-2 pb-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                      {t('pickSupplier.otherPoints')}
                    </span>
                    <ul role="group" aria-label={t('pickSupplier.otherPoints')}>
                      {others.map((s, i) => renderRow(s, home.length + i))}
                    </ul>
                  </li>
                ) : null}
              </>
            ) : (
              home.map((s, i) => renderRow(s, i))
            )}
          </ul>
          <div className="border-t border-border p-1.5">
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-full justify-start"
              onClick={() => {
                setOpen(false);
                setAddOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t('pickSupplier.addNew')}
            </Button>
          </div>
        </div>
      ) : null}

      <SupplierFormDialog
        key={String(addOpen)}
        supplier={null}
        open={addOpen}
        // Radix's own focus-restore (on unmount) would otherwise try to return
        // focus to the now-unmounted "Add a new" footer button and fall back to
        // document.body. Focusing the trigger HERE, after the dialog is told to
        // close, wins that race instead of racing it from inside `onCreated`.
        onClose={() => {
          setAddOpen(false);
          triggerRef.current?.focus();
        }}
        defaultPointId={pointId ?? undefined}
        onCreated={(created) => selectSupplier(created)}
      />
    </div>
  );
});
