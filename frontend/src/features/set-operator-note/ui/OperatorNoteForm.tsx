import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { Textarea } from '@/shared/ui/textarea';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { formatUah } from '@/shared/lib/money';
import { useSetOperatorNoteMutation } from '../api/useSetOperatorNote';

/** `SHIFT_NOT_CLOSED`'s shared sentence is about reopening; here it means «reopened, close it first». */
const OVERRIDES = { SHIFT_NOT_CLOSED: 'operatorNote.errors.notClosed' } as const;

/**
 * Spec 2026-10-06 — the body only, no `Dialog`: the close result screen swaps
 * it into its OWN dialog (one `role="dialog"`, as `RecountDrawerDialog` does),
 * and `OperatorNoteDialog` wraps it for the history table.
 */
export function OperatorNoteForm({
  shiftId,
  discrepancy,
  initialNote,
  onDone,
  onCancel,
}: {
  shiftId: string;
  discrepancy: string;
  initialNote: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const setNote = useSetOperatorNoteMutation();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ note: string }>({ defaultValues: { note: initialNote ?? '' } });

  const onSubmit = handleSubmit(async ({ note }) => {
    setFormError(null);
    try {
      await setNote.mutateAsync({ shiftId, operatorNote: note.trim() });
      toast.success(t('operatorNote.saved'));
      onDone();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'operatorNote.errors.failed', OVERRIDES));
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t('operatorNote.title', { amount: formatUah(discrepancy, i18n.resolvedLanguage) })}
        </DialogTitle>
        <DialogDescription>{t('operatorNote.description')}</DialogDescription>
      </DialogHeader>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field name="note" label={t('operatorNote.label')} required error={errors.note?.message}>
          {(a11y) => (
            <Textarea
              {...a11y}
              {...register('note', {
                required: 'operatorNote.errors.required',
                validate: (value) => value.trim().length > 0 || 'operatorNote.errors.required',
                maxLength: { value: 2000, message: 'operatorNote.errors.tooLong' },
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
          <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t('operatorNote.submit')}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
