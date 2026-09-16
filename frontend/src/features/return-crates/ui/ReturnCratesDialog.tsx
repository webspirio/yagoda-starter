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
import { Spinner } from '@/shared/ui/spinner';
import { toast } from '@/shared/ui/toast';
import { cratesRules, formatUah } from '@/shared/lib/money';
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { useSuppliersQuery, supplierName } from '@/entities/supplier';
import { useReturnCratesMutation, useReturnPreviewQuery } from '../api/useReturnCrates';

interface ReturnFormValues {
  supplier_id: string;
  units: string;
}

/**
 * «Прийняти ящики» — crates come back, and the deposit comes back with them.
 *
 * THE PREVIEW IS THE POINT OF THIS DIALOG, not decoration. §6.5 makes returns
 * consume the OLDEST issuances first and refund each tranche at the price IT
 * was taken at, and it says the operator is never asked to choose. That is the
 * right rule and a completely opaque one: someone who took 20 crates at 120 ₴
 * and 20 at 130 ₴ and brings back 25 gets a refund that neither price
 * explains. So the split is shown — and it is the SERVER'S split, fetched from
 * `POST /crate-returns/preview`. Recomputing FIFO here would be a second
 * implementation of a rule that decides real money, and the two would
 * eventually disagree in someone's favour.
 *
 * A SHORTFALL IS NAMED, NEVER CLAMPED. `shortfall > 0` means more crates are
 * being handed back than were ever taken; the server refuses the write with
 * `RETURN_EXCEEDS_OUTSTANDING`, and the preview says so first rather than
 * letting the operator find out after counting.
 */
export function ReturnCratesDialog({
  pointId,
  open,
  onClose,
}: {
  pointId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const accept = useReturnCratesMutation();
  const suppliers = useSuppliersQuery('', pointId ?? null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ReturnFormValues>({ defaultValues: { supplier_id: '', units: '' } });

  const [formError, setFormError] = useState<string | null>(null);

  const supplierId = useWatch({ control, name: 'supplier_id' });
  const unitsRaw = useWatch({ control, name: 'units' });
  // Debounced: every keystroke in the units field would otherwise be a POST.
  const units = useDebouncedValue(unitsRaw, 300);
  const parsed = Number.parseInt((units ?? '').trim(), 10);

  const preview = useReturnPreviewQuery({
    supplierId: supplierId || null,
    units: Number.isNaN(parsed) ? 0 : parsed,
    pointId,
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await accept.mutateAsync({
        ...(pointId ? { collection_point_id: pointId } : {}),
        supplier_id: values.supplier_id,
        units: Number.parseInt(values.units.trim(), 10),
      });
      toast.success(t('crates.return.toast'));
      onClose();
    } catch (error) {
      setFormError(apiErrorToBanner(error, 'crates.errors.returnFailed'));
    }
  });

  const rows = suppliers.data?.data ?? [];
  const split = preview.data;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('crates.return.title')}</DialogTitle>
          <DialogDescription>{t('crates.return.description')}</DialogDescription>
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

          <section
            aria-live="polite"
            className="rounded-md border border-line2 bg-muted/40 px-3 py-2.5 text-sm"
          >
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('crates.return.splitTitle')}
            </p>

            {preview.isFetching ? (
              <div className="flex justify-center py-2">
                <Spinner size={16} />
              </div>
            ) : preview.isError ? (
              <p role="alert" className="text-destructive">
                {t('crates.return.splitFailed')}
              </p>
            ) : !split ? (
              <p className="text-muted-foreground">{t('crates.return.splitIdle')}</p>
            ) : (
              <>
                <ul className="flex flex-col gap-1">
                  {split.allocations.map((a) => (
                    <li key={a.issuance_id} className="flex items-baseline gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{a.code}</span>
                      <span className="font-mono tabular-nums">{a.units}</span>
                      <span className="text-muted-foreground">
                        {a.mode === 'receipt'
                          ? t('crates.return.byReceipt')
                          : t('crates.return.byDeposit', {
                              price: formatUah(a.per_unit, i18n.language),
                            })}
                      </span>
                      <span className="ml-auto font-mono tabular-nums">
                        {a.mode === 'receipt' ? '—' : formatUah(a.amount, i18n.language)}
                      </span>
                    </li>
                  ))}
                </ul>

                <p className="mt-2 flex items-baseline justify-between border-t border-line2 pt-2 font-medium">
                  <span>{t('crates.return.refund')}</span>
                  <span className="font-mono tabular-nums">
                    {formatUah(split.deposit_refund, i18n.language)}
                  </span>
                </p>

                {split.shortfall > 0 ? (
                  <p role="alert" className="mt-2 text-sm text-destructive">
                    {t('crates.return.shortfall', { count: split.shortfall })}
                  </p>
                ) : null}
              </>
            )}
          </section>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || (split ? split.shortfall > 0 : false)}
            >
              {t('crates.return.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
