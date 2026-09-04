import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';

interface CopyableFieldProps {
  label: string;
  value: string;
  mono?: boolean;
}

const COPIED_FEEDBACK_MS = 1500;

export function CopyableField({ label, value, mono = false }: CopyableFieldProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleCopy = useCallback(async () => {
    await copyToClipboard(value);
    setCopied(true);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, [value]);

  // Cancel a pending "Copied" reset if the field unmounts within the window.
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn('truncate text-sm', mono && 'font-mono')}>{value}</div>
      </div>
      <Tooltip open={copied}>
        <TooltipTrigger asChild>
          <Button onClick={handleCopy} size="icon" variant="ghost" aria-label={t('common.copy')}>
            <Copy className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">{t('common.copied')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
