import { Cherry } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoginForm } from '@/features/auth';
import { PageHeader } from '@/shared/ui/page-header';

/** The product's name above the form, on the app's `PageHeader` (audit 2026-10-24, F9/F11):
 *  a sign-in screen that does not say whose it is reads like a phishing page. */
export function LoginPage() {
  const { t } = useTranslation();
  return (
    <div className="w-full max-w-sm">
      <div className="mb-4 flex items-center gap-2">
        <Cherry aria-hidden="true" className="size-6 text-brand" />
        <span className="font-display text-lg font-semibold">{t('shell.brand')}</span>
      </div>
      <PageHeader title={t('auth.signIn')} />
      <LoginForm />
    </div>
  );
}
