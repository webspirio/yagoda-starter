import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import { TextInput } from '@/shared/ui/text-input';
import { SelectField } from '@/shared/ui/select-field';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { cratesRules } from '@/shared/lib/money';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { useSuppliersQuery, supplierName } from '@/entities/supplier';
import type { CrateIssuanceMode } from '@/entities/crate';
import { useIssueCratesMutation } from '../api/useIssueCrates';

interface IssueFormValues {
  supplier_id: string;
  units: string;
  mode: CrateIssuanceMode;
}

/**
 * «Видати ящики» — crates go home with a supplier (§6.4).
 *
 * THE TWO MODES ARE SPELLED OUT ON SCREEN, not left to the label. «Завдаток»
 * takes money into the point's crates drawer now; «розписка» takes a signature
 * and **no money at all**, so the crates are out with no cash cover behind
 * them. Both put the same crates on the same balance — §6.4: «різниця лише в
 * грошах» — and an operator who does not know which one they are choosing is
 * choosing whether the network is covered.
 *
 * THE DEPOSIT PRICE IS NOT ENTERED HERE. It comes from whichever tare type is
 * marked as the crate, and the server reads it; a field would invite someone
 * to type a different number than the catalogue says.
 */
export function IssueCratesDialog({
  pointId,
  open,
  onClose,
}: {
  /** Passed by an OWNER, who has no point of their own; omitted for an
   *  operator, whose point comes from their token. */
  pointId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const issue = useIssueCratesMutation();
  const suppliers = useSuppliersQuery('', pointId ?? null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<IssueFormValues>({
    defaultValues: { supplier_id: '', units: '', mode: 'deposit' },
  });

  const [formError, setFormError] = useState<string | null>(null);
  // `useWatch`, not `watch()` — the same choice `PayoutDialog` makes, and the
  // one the react-hooks lint rule accepts.
  const mode = useWatch({ control, name: 'mode' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await issue.mutateAsync({
        ...(pointId ? { collection_point_id: pointId } : {}),
        supplier_id: values.supplier_id,
        // A row COUNT, not money — parsed as an integer, never through money.ts.
        units: Number.parseInt(values.units.trim(), 10),
        mode: values.mode,
      });
      toast.success(t('crates.issue.toast'));
      onClose();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'crates.errors.issueFailed'));
    }
  });

  const rows = suppliers.data?.data ?? [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('crates.issue.title')}</DialogTitle>
          <DialogDescription>{t('crates.issue.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="supplier_id"
            label={t('crates.field.supplier')}
            required
            error={errors.supplier_id?.message}
          >
            {(a11y) => (
              <SelectField
                {...a11y}
                {...register('supplier_id', { required: 'crates.errors.supplierRequired' })}
              >
                <option value="">{t('crates.field.supplierPlaceholder')}</option>
                {rows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {supplierName(s)}
                  </option>
                ))}
              </SelectField>
            )}
          </Field>

          <Field
            name="units"
            label={t('crates.field.units')}
            required
            error={errors.units?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="numeric"
                className="font-mono"
                {...register('units', cratesRules('crates.errors.unitsFormat'))}
              />
            )}
          </Field>

          <Field name="mode" label={t('crates.field.mode')} required error={errors.mode?.message}>
            {(a11y) => (
              <SelectField {...a11y} {...register('mode', { required: true })}>
                <option value="deposit">{t('crates.mode.deposit')}</option>
                <option value="receipt">{t('crates.mode.receipt')}</option>
              </SelectField>
            )}
          </Field>

          {/* The consequence of the choice, in words, next to the choice. */}
          <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            {mode === 'receipt' ? t('crates.mode.receiptHint') : t('crates.mode.depositHint')}
          </p>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('crates.issue.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
