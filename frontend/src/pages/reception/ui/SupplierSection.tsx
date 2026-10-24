import type { Ref } from 'react';
import { type Supplier } from '@/entities/supplier';
import { SupplierPicker, type SupplierPickerHandle } from '@/features/pick-supplier';
import { SupplierProfile } from './SupplierProfile';

/**
 * The picker, stretched across the row, and beside it the profile button
 * (`SupplierProfile`): contacts, balance, crates, the season and the last
 * receipts sit in its popup, so the row itself stays one calm line.
 *
 * Search, pick, and inline creation all live in `SupplierPicker`
 * (`@/features/pick-supplier`). The parent owns the whole
 * `Supplier` object (not just its id) because the document only carries the
 * id — the picker already had the full row in hand when it was chosen.
 */
export function SupplierSection({
  pointId,
  ownerMode,
  supplier,
  onChange,
  disabled,
  pickerRef,
  autoFocus,
}: {
  pointId: string | null;
  ownerMode: boolean;
  supplier: Supplier | null;
  onChange: (s: Supplier) => void;
  disabled: boolean;
  pickerRef?: Ref<SupplierPickerHandle>;
  /** Autofocus the picker's trigger — the page passes this only while no
   *  supplier is chosen yet, so returning to this screen (or resetting after
   *  a submit) doesn't steal focus back from whatever the operator is doing. */
  autoFocus?: boolean;
}) {
  return (
    // `py-2` around the picker's 48 px trigger keeps the row at 64 px (§5.1).
    <div className="flex items-center gap-2 px-4 pt-4 pb-3">
      <div className="min-w-0 flex-1">
        <SupplierPicker
          ref={pickerRef}
          pointId={pointId}
          ownerMode={ownerMode}
          value={supplier}
          onChange={onChange}
          disabled={disabled}
          autoFocus={autoFocus}
        />
      </div>

      {supplier ? <SupplierProfile supplier={supplier} /> : null}
    </div>
  );
}
