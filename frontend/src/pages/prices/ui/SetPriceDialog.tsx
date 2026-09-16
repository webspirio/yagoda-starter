import { useState } from 'react';
import { History } from 'lucide-react';
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
import { TextInput } from '@/shared/ui/text-input';
import { Textarea } from '@/shared/ui/textarea';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import type { GradeCatalogItem } from '@/entities/product-grade';
import { useSetPriceMutation } from '../api/gradePrices';
import { useBulkSetPriceMutation } from '../api/priceSheet';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { PriceFormValues } from '../model/gradePrice';

const FIELD_NAMES = ['base_price', 'max_markup', 'max_discount'] as const;

/** Mirrors the backend `@Matches(/^\d{1,8}(\.\d{1,2})?$/)` on all three money
 *  fields — no sign, up to 8 integer digits, at most 2 decimals. Client-side
 *  UX only; the server re-validates. */
const DECIMAL = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * Set (append) a grade's price. One dialog, no create/edit split — a price is
 * never patched, only appended, so "set" is the only verb.
 *
 * TWO MODES, ONE FORM. `pointIds` with a single id is the cell write
 * (`POST /grade-prices`); with several it is «поставити всім»
 * (`POST /grade-prices/bulk`, one transaction). The FIELDS are identical in
 * both, and that is the reason they share a dialog rather than forking: all
 * three numbers are NOT NULL with no default, so the bulk write has exactly the
 * same shape as the single one and a second form would drift from this one.
 *
 * THE DIALOG NAMES THE POINTS IT WILL WRITE. A gesture that silently skips the
 * warehouse must SAY it skips the warehouse (§4.8), or the next owner reads the
 * unchanged column as a bug.
 *
 * `current` pre-fills the fields when the grade already has a price, so the
 * owner nudges a number rather than retyping the row. The parent remounts it via
 * a changing `key` on every open, so there is no reset effect.
 */
export function SetPriceDialog({
  pointIds,
  pointName,
  grade,
  current,
  open,
  onClose,
  onShowHistory,
}: {
  /** One id — the cell write. Several — «поставити всім». Never empty. */
  pointIds: string[];
  /** What the dialog calls the target: one point's name, or «усі пункти прийому (4)». */
  pointName: string;
  grade: GradeCatalogItem;
  current: { base_price: string; max_markup: string; max_discount: string } | null;
  open: boolean;
  onClose: () => void;
  /** Offered only for a SINGLE point that already has a price: the journal is
   *  per (point, grade), so it has no meaning for a bulk write spanning five. */
  onShowHistory?: () => void;
}) {
  const { t } = useTranslation();
  const setPrice = useSetPriceMutation();
  const setEverywhere = useBulkSetPriceMutation();
  const isBulk = pointIds.length > 1;

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PriceFormValues>({
    defaultValues: {
      base_price: current?.base_price ?? '',
      max_markup: current?.max_markup ?? '',
      max_discount: current?.max_discount ?? '',
      reason: '',
    },
  });

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const reason = values.reason.trim();
    const numbers = {
      base_price: values.base_price.trim(),
      max_markup: values.max_markup.trim(),
      max_discount: values.max_discount.trim(),
      ...(reason ? { reason } : {}),
    };
    try {
      if (isBulk) {
        const { created } = await setEverywhere.mutateAsync({
          product_grade_id: grade.id,
          collection_point_ids: pointIds,
          ...numbers,
        });
        // The COUNT is reported, not a bare «done»: the whole risk of this
        // gesture is writing a different number of points than the owner meant.
        toast.success(t('prices.toast.setAll', { count: created }));
      } else {
        await setPrice.mutateAsync({
          collection_point_id: pointIds[0],
          product_grade_id: grade.id,
          ...numbers,
        });
        toast.success(t('prices.toast.set'));
      }
      onClose();
    } catch (error) {
      const mapped = apiErrorToFields(error, FIELD_NAMES);
      for (const { field, messageKey } of mapped.fieldErrors) {
        setError(field as keyof PriceFormValues, { message: messageKey });
      }
      setFormError(mapped.formErrorKey);
    }
  });

  const gradeLabel = `${grade.productName} · ${grade.name}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('prices.form.title', { grade: gradeLabel })}</DialogTitle>
          <DialogDescription>
            {isBulk
              ? t('prices.form.descriptionAll', { points: pointName })
              : t('prices.form.description', { point: pointName })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="base_price"
            label={t('prices.form.base')}
            required
            error={errors.base_price?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                className="font-mono"
                {...register('base_price', {
                  required: 'prices.errors.priceFormat',
                  pattern: { value: DECIMAL, message: 'prices.errors.priceFormat' },
                })}
                autoFocus
              />
            )}
          </Field>

          <Field
            name="max_markup"
            label={t('prices.form.markup')}
            required
            error={errors.max_markup?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                className="font-mono"
                {...register('max_markup', {
                  required: 'prices.errors.priceFormat',
                  pattern: { value: DECIMAL, message: 'prices.errors.priceFormat' },
                })}
              />
            )}
          </Field>

          <Field
            name="max_discount"
            label={t('prices.form.discount')}
            required
            error={errors.max_discount?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                className="font-mono"
                {...register('max_discount', {
                  required: 'prices.errors.priceFormat',
                  pattern: { value: DECIMAL, message: 'prices.errors.priceFormat' },
                })}
              />
            )}
          </Field>

          <Field name="reason" label={t('prices.form.reason')} error={errors.reason?.message}>
            {(a11y) => (
              <Textarea
                {...a11y}
                {...register('reason', {
                  maxLength: { value: 1000, message: 'prices.errors.reasonTooLong' },
                })}
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
            {!isBulk && current && onShowHistory ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onShowHistory}
                disabled={isSubmitting}
              >
                <History className="size-3.5" />
                {t('prices.history.button')}
              </Button>
            ) : null}
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
