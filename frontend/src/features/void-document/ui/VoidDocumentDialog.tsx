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
import { toBannerError, type BannerError } from '@/shared/lib/api-error';
import { formatUah } from '@/shared/lib/money';
import { formatTime } from '@/shared/lib/date';
import { VoidConsequences } from './VoidConsequences';

/** An intake's live payout: the void takes it too, cash back in the drawer (2026-09-28). */
export interface LinkedPayout {
  code: string;
  amount: string;
  /** When and by whom it was handed over. */
  paidAt: string;
  paidBy: string | null;
  /** Receipt codes that reopen with it; null until the settlement loads — the void refuses to
   *  submit until then, so the reopen box cannot be skipped. */
  reopens: string[] | null;
  /** The settlement read failed: the dialog swaps the reopen box for a «list unknown» one. */
  reopensFailed?: boolean;
  /** Refetches the settlement after a failure. */
  retryReopens?: () => void;
}

interface VoidFormValues {
  reason: string;
  /** One required tick per open-shift consequence, keyed by its id — a UI gate only (spec
   *  decision 8). Keyed, not indexed: a box swapped for another must not inherit its tick. */
  acks: Record<string, boolean>;
}

interface VoidDocumentDialogProps {
  kind: 'intake' | 'payout' | 'transfer' | 'topUp' | 'crateIssuance' | 'crateReturn';
  id: string;
  code: string;
  open: boolean;
  onClose: () => void;
  /** Fires after a successful void, before `onClose` — e.g. to refresh a detail view. */
  onVoided?: () => void;
  /** Intake only: its live payout, if any. */
  linkedPayout?: LinkedPayout;
  /** Intake without a live payout: the debt the void takes off. */
  intakeAmount?: string;
  /** Payout only: the amount going back to the drawer, and the receipts that reopen. */
  payoutAmount?: string;
  reopens?: string[] | null;
  /** Payout only: a closed shift's void returns no cash, so there is nothing to tick. An intake
   *  is never voided in a closed shift (2026-09-30). */
  shiftClosed?: boolean;
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
  shiftClosed,
  intakeAmount,
  payoutAmount,
  reopens,
}: VoidDocumentDialogProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const money = (v: string) => formatUah(v, locale);
  const voidDocument = useVoidDocumentMutation();
  const openLinkedPayout = kind === 'intake' ? linkedPayout : undefined;
  // A failed read is not «not ready»: `reopens` is disclosure only, so the void goes on
  // behind its own box (#173 review) rather than locking the operator out.
  const reopensFailed =
    openLinkedPayout?.reopens === null && openLinkedPayout.reopensFailed === true;
  const notReady = openLinkedPayout?.reopens === null && !reopensFailed;

  const reopen = (codes?: string[] | null) =>
    codes?.length
      ? [{ id: 'reopens', text: t('void.ack.reopens', { codes: codes.join(', ') }) }]
      : [];
  const consequences = shiftClosed
    ? null
    : kind === 'payout' && payoutAmount
      ? [
          { id: 'payoutCash', text: t('void.ack.payoutCash', { amount: money(payoutAmount) }) },
          ...reopen(reopens),
        ]
      : openLinkedPayout
        ? [
            { id: 'cash', text: t('void.ack.cash', { amount: money(openLinkedPayout.amount) }) },
            { id: 'payout', text: t('void.ack.payout', { code: openLinkedPayout.code }) },
            ...(reopensFailed
              ? [{ id: 'reopensUnknown', text: t('void.ack.reopensUnknown') }]
              : reopen(openLinkedPayout.reopens)),
          ]
        : kind === 'intake' && intakeAmount
          ? [{ id: 'debt', text: t('void.ack.debt', { amount: money(intakeAmount) }) }]
          : null;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<VoidFormValues>({ defaultValues: { reason: '', acks: {} } });

  const [formError, setFormError] = useState<BannerError | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await voidDocument.mutateAsync({
        kind,
        id,
        reason: values.reason.trim(),
      });
      toast.success(t('void.toast.voided'));
      onVoided?.();
      onClose();
    } catch (error) {
      setFormError(toBannerError(error, 'void.errors.failed'));
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
              box={(ackId) => register(`acks.${ackId}`, { required: 'void.ack.required' })}
              error={errors.acks ? 'void.ack.required' : undefined}
            />
          ) : null}
          {notReady ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          ) : null}
          {reopensFailed ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 text-sm text-destructive"
            >
              <span>{t('void.reopensFailed')}</span>
              {openLinkedPayout.retryReopens ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={openLinkedPayout.retryReopens}
                >
                  {t('common.retry')}
                </Button>
              ) : null}
            </div>
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
              {t(formError.key, formError.params)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={isSubmitting || notReady}>
              {t('void.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
