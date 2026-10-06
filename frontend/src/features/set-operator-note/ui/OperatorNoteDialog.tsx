import { Dialog, DialogContent } from '@/shared/ui/dialog';
import { OperatorNoteForm } from './OperatorNoteForm';

/** The form in a dialog of its own — for `CashCountHistory`, which has no dialog to swap. */
export function OperatorNoteDialog({
  shiftId,
  discrepancy,
  initialNote,
  open,
  onClose,
}: {
  shiftId: string;
  discrepancy: string;
  initialNote: string | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <OperatorNoteForm
          shiftId={shiftId}
          discrepancy={discrepancy}
          initialNote={initialNote}
          onDone={onClose}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
