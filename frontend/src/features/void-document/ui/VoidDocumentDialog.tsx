import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { Textarea } from '@/shared/ui/textarea';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { useVoidDocumentMutation } from '../api/useVoidDocument';
import { apiErrorToBanner } from '@/shared/lib/api-error';

interface VoidFormValues {
  reason: string;
}

/**
 * «Анулювати» — void an intake or payout with a reason. A document is never
 * edited (§2.7/§9.3): this freezes it rather than changing its numbers, and
 * the reason is what's left in the journal — the operator writes a fresh
 * document afterwards for the correction itself. `code` is the document's
 * human-readable receipt/payout number, named in the title so the confirming
 * click is never a guess about which document is about to go away.
 */
export function VoidDocumentDialog({
  kind,
  id,
  code,
  open,
  onClose,
  onVoided,
}: {
  kind: 'intake' | 'payout' | 'transfer' | 'topUp' | 'crateIssuance' | 'crateReturn';
  id: string;
  code: string;
  open: boolean;
  onClose: () => void;
  /** Fires after a successful void, before `onClose` — e.g. to refresh a detail view. */
  onVoided?: () => void;
}) {
  const { t } = useTranslation();
  const voidDocument = useVoidDocumentMutation();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VoidFormValues>({ defaultValues: { reason: '' } });

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await voidDocument.mutateAsync({ kind, id, reason: values.reason.trim() });
      toast.success(t('void.toast.voided'));
      onVoided?.();
      onClose();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'void.errors.failed'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('void.title', { code })}</DialogTitle>
          <DialogDescription>{t('void.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field name="reason" label={t('void.reason')} required error={errors.reason?.message}>
            {(a11y) => (
              <Textarea
                {...a11y}
                {...register('reason', {
                  validate: (value) => value.trim().length > 0 || 'void.errors.reasonRequired',
                })}
                autoFocus
              />
            )}
          </Field>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {t('void.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
