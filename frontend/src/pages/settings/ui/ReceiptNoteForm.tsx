import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { useUpdateNetworkSettingsMutation } from '../api/useUpdateNetworkSettingsMutation';
import { ReceiptNoteField } from './ReceiptNoteField';

/** Mounted with the saved note; the page remounts it after each save (`key`). */
export function ReceiptNoteForm({ saved }: { saved: string }) {
  const { t } = useTranslation();
  const [note, setNote] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const mutation = useUpdateNetworkSettingsMutation();

  // Blank is stored as null, so whitespace over an empty note is no change.
  const next = note.trim() === '' ? null : note;
  const dirty = (next ?? '') !== saved;

  const submit = async () => {
    setError(null);
    try {
      await mutation.mutateAsync({ receipt_note: next });
      toast.success(t('settings.saved'));
    } catch (e) {
      setError(apiErrorToBanner(e, 'settings.errors.failed'));
    }
  };

  return (
    <SectionCard title={t('settings.receipt.title')}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ReceiptNoteField value={note} onChange={setNote} />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        ) : null}
        <Button type="submit" disabled={!dirty || mutation.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </SectionCard>
  );
}
