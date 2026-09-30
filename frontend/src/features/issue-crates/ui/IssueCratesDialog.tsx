import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { toBannerError, type BannerError } from '@/shared/lib/api-error';
import { ApiError } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useSuppliersQuery, supplierName } from '@/entities/supplier';
import { useCrateStandingQuery, type CrateIssuanceMode } from '@/entities/crate';
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
  const qc = useQueryClient();
  const issue = useIssueCratesMutation();
  const suppliers = useSuppliersQuery('', pointId ?? null);
  const standing = useCrateStandingQuery({ pointId: pointId ?? null, isOwner: Boolean(pointId) });
  const onHand = standing.data?.on_hand;
  const inTransit = standing.data?.in_transit ?? 0;
  const noneLeft = onHand !== undefined && onHand <= 0;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<IssueFormValues>({
    defaultValues: { supplier_id: '', units: '', mode: 'deposit' },
  });

  const [formError, setFormError] = useState<BannerError | null>(null);
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
      // The server counted differently from the hint — bring the hint up to its figure.
      if (error instanceof ApiError && error.code === 'CRATES_ON_HAND_INSUFFICIENT') {
        void qc.invalidateQueries({ queryKey: queryKeys.crateBalances });
      }
      setFormError(
        toBannerError(error, 'crates.errors.issueFailed', {
          // Shared code, screen-specific consequence — see `apiErrorToBanner`.
          SUPPLIER_INACTIVE: 'crates.errors.supplierInactive',
        }),
      );
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
            errorParams={{ on_hand: onHand }}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="numeric"
                className="font-mono"
                {...register('units', {
                  ...cratesRules('crates.errors.unitsFormat'),
                  // A hint, not the rule: the server's CrateStockGuard is the final word.
                  validate: {
                    format: cratesRules('crates.errors.unitsFormat').validate,
                    onHand: (v: string) =>
                      onHand === undefined ||
                      Number.parseInt(v.trim(), 10) <= onHand ||
                      'crates.errors.overOnHand',
                  },
                })}
              />
            )}
          </Field>
          {onHand !== undefined ? (
            <p className={noneLeft ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {t('crates.issue.onHandHint', { on_hand: onHand })}
              {inTransit > 0 ? ` ${t('crates.issue.inTransitHint', { in_transit: inTransit })}` : null}
            </p>
          ) : null}

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
              {t(formError.key, formError.params)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || noneLeft}>
              {t('crates.issue.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
