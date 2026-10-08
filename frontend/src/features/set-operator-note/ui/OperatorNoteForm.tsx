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
import type { CashCount } from '@/entities/cash-count';
import { useSetOperatorNoteMutation } from '../api/useSetOperatorNote';

/**
 * Spec 2026-10-08 — the note belongs to ONE count (`count`) — the body only, no `Dialog`: the close result screen swaps
 * it into its OWN dialog (one `role="dialog"`, as `RecountDrawerDialog` does),
 * and `OperatorNoteDialog` wraps it for the history table.
 */
export function OperatorNoteForm({
  count,
  onDone,
  onCancel,
}: {
  count: CashCount;
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
  } = useForm<{ note: string }>({ defaultValues: { note: count.operator_note ?? '' } });

  const onSubmit = handleSubmit(async ({ note }) => {
    setFormError(null);
    try {
      await setNote.mutateAsync({ countId: count.id, operatorNote: note.trim() });
      toast.success(t('operatorNote.saved'));
      onDone();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'operatorNote.errors.failed'));
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(count.kind === 'opening' ? 'operatorNote.titleOpening' : 'operatorNote.titleClosing', {
            amount: formatUah(count.discrepancy, i18n.resolvedLanguage),
          })}
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
