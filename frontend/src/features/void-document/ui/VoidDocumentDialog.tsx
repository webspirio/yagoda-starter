import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { useVoidDocumentMutation, type PayoutDecision } from '../api/useVoidDocument';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { formatUah } from '@/shared/lib/money';
import { formatTime } from '@/shared/lib/date';
import { PayoutDecisionField, type LinkedPayout } from './PayoutDecisionField';
import { VoidConsequences } from './VoidConsequences';

interface VoidFormValues {
  reason: string;
  /** #125: only asked for a closed-shift intake with a live linked payout — see `showDecision`. */
  payout?: PayoutDecision;
  /** One required tick per open-shift consequence — a UI gate only (spec decision 8). */
  acks: boolean[];
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
  linkedPayout,
  shiftClosed = false,
  intakeAmount,
  payoutAmount,
  reopens,
}: {
  kind: 'intake' | 'payout' | 'transfer' | 'topUp' | 'crateIssuance' | 'crateReturn';
  id: string;
  code: string;
  open: boolean;
  onClose: () => void;
  /** Fires after a successful void, before `onClose` — e.g. to refresh a detail view. */
  onVoided?: () => void;
  /** #125: the intake's live payout, if any — asks what happens to it too. */
  linkedPayout?: LinkedPayout;
  /** Closed shift: #125's three choices. Open: the void returns the cash, so the dialog
   *  lists every consequence as a checkbox instead (2026-09-28). */
  shiftClosed?: boolean;
  /** Intake without a live payout: the debt the void takes off. */
  intakeAmount?: string;
  /** Payout only: the amount going back to the drawer, and the receipts that reopen. */
  payoutAmount?: string;
  reopens?: string[] | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const money = (v: string) => formatUah(v, locale);
  const voidDocument = useVoidDocumentMutation();
  const showDecision = kind === 'intake' && linkedPayout !== undefined && shiftClosed;
  const openLinkedPayout = kind === 'intake' && !shiftClosed ? linkedPayout : undefined;

  const reopen = (codes?: string[] | null) => (codes?.length ? [t('void.ack.reopens', { codes: codes.join(', ') })] : []);
  const consequences = shiftClosed
    ? null
    : kind === 'payout' && payoutAmount
      ? [t('void.ack.payoutCash', { amount: money(payoutAmount) }), ...reopen(reopens)]
      : openLinkedPayout
        ? [
            t('void.ack.cash', { amount: money(openLinkedPayout.amount) }),
            t('void.ack.payout', { code: openLinkedPayout.code }),
            ...reopen(openLinkedPayout.reopens),
          ]
        : kind === 'intake' && intakeAmount
          ? [t('void.ack.debt', { amount: money(intakeAmount) })]
          : null;

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<VoidFormValues>({ defaultValues: { reason: '', acks: [] } });

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await voidDocument.mutateAsync({
        kind,
        id,
        reason: values.reason.trim(),
        ...(showDecision && values.payout ? { payout: values.payout } : {}),
      });
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
          {showDecision ? (
            <Controller
              control={control}
              name="payout"
              rules={{ validate: (v) => v !== undefined || 'void.payout.required' }}
              render={({ field, fieldState }) => (
                <PayoutDecisionField
                  payout={linkedPayout}
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                  firstRadioRef={field.ref}
                />
              )}
            />
          ) : null}

          {openLinkedPayout ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/8 p-3 text-sm">
              <p className="font-medium">{t('void.card.title')}</p>
              <p>
                {openLinkedPayout.code} · {money(openLinkedPayout.amount)}
              </p>
              <p className="text-muted-foreground">
                {t('void.card.paid', {
                  when: formatTime(openLinkedPayout.paidAt, locale),
                  who: openLinkedPayout.paidBy ?? '—',
                })}
              </p>
            </div>
          ) : null}

          {consequences ? (
            <VoidConsequences
              items={consequences}
              box={(i) => register(`acks.${i}`, { required: 'void.ack.required' })}
              error={errors.acks ? 'void.ack.required' : undefined}
            />
          ) : null}

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
