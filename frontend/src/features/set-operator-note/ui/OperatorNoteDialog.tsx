import { Dialog, DialogContent } from '@/shared/ui/dialog';
import type { CashCount } from '@/entities/cash-count';
import { OperatorNoteForm } from './OperatorNoteForm';

/** The form in a dialog of its own — for `CashCountHistory`, which has no dialog to swap. */
export function OperatorNoteDialog({
  count,
  open,
  onClose,
}: {
  count: CashCount | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {count ? <OperatorNoteForm count={count} onDone={onClose} onCancel={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}
