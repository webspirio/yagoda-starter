import { useState } from 'react';

/**
 * The receipt state every page that opens `ReceiptDialog` keeps: which
 * receipt, whether it is open, and whether a row's «Анулювати» asked for it
 * to open straight into its void. Every open goes through `openReceipt`, so
 * a plain open never inherits an earlier void request.
 *
 * `close` keeps `receiptId` (for a dialog keyed on it that should stay
 * mounted while it animates out); `clear` drops it too (for a dialog that
 * unmounts on close).
 */
export function useReceiptOpener() {
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [startWithVoid, setStartWithVoid] = useState(false);

  const openReceipt = (intakeId: string, { void: withVoid = false }: { void?: boolean } = {}) => {
    setReceiptId(intakeId);
    setStartWithVoid(withVoid);
    setOpen(true);
  };
  const close = () => setOpen(false);
  const clear = () => {
    setOpen(false);
    setReceiptId(null);
  };

  return { receiptId, open, startWithVoid, openReceipt, close, clear };
}
