import type { ReactNode } from 'react';
import { toast, type ExternalToast } from 'sonner';

/**
 * Sonner re-export + success/error helpers. Use these for mutation results so
 * feel and feedback stay consistent app-wide.
 */
export { toast };

export function toastSuccess(message: ReactNode, options?: ExternalToast) {
  return toast.success(message, options);
}

export function toastError(message: ReactNode, options?: ExternalToast) {
  return toast.error(message, options);
}
