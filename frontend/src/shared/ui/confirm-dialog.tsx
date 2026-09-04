import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Pass t() strings — all copy comes from the caller's locale files. */
  confirmLabel: string;
  cancelLabel: string;
  /** Renders the confirm button in the destructive style (red). */
  destructive?: boolean;
  /** Fired on confirm; the dialog closes itself afterwards. */
  onConfirm: () => void;
}

/**
 * alert-dialog wrapper for «are you sure?» moments (destructive or
 * hard-to-undo actions). Confirm-and-close semantics — run the mutation
 * optimistically from `onConfirm` and surface the result via toasts.
 *
 * Cancelling: Radix's AlertDialog already closes on Escape, and this wrapper
 * never overrides that — no extra handling needed here.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description != null && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="cta">{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? 'destructive' : 'default'}
            size="cta"
            onClick={() => onConfirm()}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
