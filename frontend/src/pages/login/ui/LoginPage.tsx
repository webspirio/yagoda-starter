import { useTranslation } from 'react-i18next';
import { LoginForm } from '@/features/auth';

export function LoginPage() {
  const { t } = useTranslation();
  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-6 text-center text-2xl font-semibold">{t('auth.signIn')}</h1>
      <LoginForm />
    </div>
  );
}
