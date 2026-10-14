import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 24, className }: SpinnerProps) {
  const { t } = useTranslation();
  return (
    <Loader2
      role="progressbar"
      aria-label={t('common.loading')}
      size={size}
      className={cn('animate-spin text-brand', className)}
    />
  );
}
