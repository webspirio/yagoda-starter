import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
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
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { PriceFormValues } from '../model/gradePrice';

const FIELD_NAMES = ['base_price', 'max_markup', 'max_discount'] as const;

/** Mirrors the backend `@Matches(/^\d{1,8}(\.\d{1,2})?$/)` on all three money
 *  fields — no sign, up to 8 integer digits, at most 2 decimals. Client-side
 *  UX only; the server re-validates. */
const DECIMAL = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * Set (append) a grade's price at the selected point. One dialog, no create/edit
 * split — a price is never patched, only appended, so "set" is the only verb.
 * `current` pre-fills the fields when the grade already has a price, so the owner
 * nudges a number rather than retyping the row. The parent remounts it via a
 * changing `key` on every open, so there is no reset effect.
 */
export function SetPriceDialog({
  pointId,
  grade,
  current,
  open,
  onClose,
}: {
  pointId: string;
  grade: GradeCatalogItem;
  current: { base_price: string; max_markup: string; max_discount: string } | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const setPrice = useSetPriceMutation();

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
    try {
      await setPrice.mutateAsync({
        collection_point_id: pointId,
        product_grade_id: grade.id,
        base_price: values.base_price.trim(),
        max_markup: values.max_markup.trim(),
        max_discount: values.max_discount.trim(),
        ...(reason ? { reason } : {}),
      });
      toast.success(t('prices.toast.set'));
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
                  maxLength: { value: 1000, message: 'prices.errors.saveFailed' },
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
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
