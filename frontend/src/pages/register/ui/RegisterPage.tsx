import { useTranslation } from 'react-i18next';
import { RegisterForm } from '@/features/auth';

export function RegisterPage() {
  const { t } = useTranslation();
  return (
    <div className="w-full max-w-sm">
      <h1 className="mb-6 text-center text-2xl font-semibold">{t('auth.signUp')}</h1>
      <RegisterForm />
    </div>
  );
}
