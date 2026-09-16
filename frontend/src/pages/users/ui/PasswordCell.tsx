import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, focusRing } from '@/shared/lib/cn';
import { Spinner } from '@/shared/ui/spinner';
import { useRevealPasswordMutation } from '../api/users';
import type { AdminUser, RevealedPassword } from '../model/user';

/**
 * The owner's «око» on the registry — issue #11's «бачити логін та пароль
 * кожного користувача».
 *
 * WHAT IT IS NOT: the eye inside a password FIELD (`shared/ui/password-input`),
 * which only unmasks what the person is typing. This one asks the server for
 * somebody else's stored password, so it fetches on the press rather than
 * rendering a value the list already had — no password is ever part of the
 * list response, and every reading is audited server-side.
 *
 * `password: null` has two very different cures, and the cell says which:
 * either the deployment has no key at all, or this one credential predates the
 * vault and a reissue fixes it.
 */
export function PasswordCell({
  user,
  isOpen,
  onOpen,
  onClose,
}: {
  user: AdminUser;
  /** Whether THIS row is the one currently shown — the page allows one. */
  isOpen: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reveal = useRevealPasswordMutation();
  const [shown, setShown] = useState<RevealedPassword | null>(null);
  const [failed, setFailed] = useState(false);

  // The page may hand the row away to another row's eye; drop the value with it
  // rather than keeping a password in a hidden component.
  const value = isOpen ? shown : null;

  const toggle = async () => {
    if (isOpen) {
      setShown(null);
      onClose();
      return;
    }
    setFailed(false);
    onOpen(user.id);
    try {
      setShown(await reveal.mutateAsync(user.id));
    } catch {
      setShown(null);
      setFailed(true);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        // The row itself opens the edit dialog. Without this the eye would do
        // both, and the password would appear behind a modal.
        onClick={(event) => {
          event.stopPropagation();
          void toggle();
        }}
        aria-pressed={isOpen}
        aria-label={t(isOpen ? 'common.hidePassword' : 'common.showPassword')}
        title={t(isOpen ? 'common.hidePassword' : 'common.showPassword')}
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg',
          'text-muted-foreground transition-colors hover:text-foreground',
          focusRing,
        )}
      >
        {isOpen ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
      </button>

      {reveal.isPending && isOpen ? (
        <Spinner className="size-4" />
      ) : value?.password ? (
        // `select-all` so one click grabs the whole password to read it out or
        // paste it into a message.
        <span className="select-all font-mono text-sm">{value.password}</span>
      ) : failed ? (
        <span className="text-xs text-destructive">{t('users.password.failed')}</span>
      ) : value ? (
        <span className="text-xs text-muted-foreground">
          {t(value.vault_enabled ? 'users.password.reissue' : 'users.password.vaultOff')}
        </span>
      ) : (
        <span aria-hidden="true" className="text-muted2 tracking-widest">
          ••••
        </span>
      )}
    </div>
  );
}
