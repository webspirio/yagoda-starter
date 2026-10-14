import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/ui/page-header';
import { Spinner } from '@/shared/ui/spinner';
import { useNetworkSettingsQuery } from '@/entities/network-settings';
import { ReceiptNoteForm } from './ReceiptNoteForm';

/** «Налаштування мережі» — owner-only (route gate). One card per setting. */
export function SettingsPage() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useNetworkSettingsQuery();

  return (
    <>
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('settings.title')}
        description={t('settings.description')}
      />
      {isError ? (
        <p role="alert" className="text-destructive">
          {t('common.somethingWentWrong')}
        </p>
      ) : isPending ? (
        <Spinner />
      ) : (
        // A save seeds a new `updated_at`, which remounts the form on the saved text.
        <ReceiptNoteForm key={data.updated_at} saved={data.receipt_note ?? ''} />
      )}
    </>
  );
}
