import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, focusRing } from '@/shared/lib/cn';
import { Spinner } from '@/shared/ui/spinner';
import type { RevealedPassword } from '../model/user';

/**
 * The owner's «око» on the registry — issue #11's «бачити логін та пароль
 * кожного користувача».
 *
 * WHAT IT IS NOT: the eye inside a password FIELD (`shared/ui/password-input`),
 * which only unmasks what the person is typing. This one shows somebody else's
 * stored password, which the page fetches on the press — no password is ever
 * part of the list response, and every reading is audited server-side.
 *
 * PURELY PRESENTATIONAL, AND THAT IS THE SECURITY PROPERTY. The plaintext
 * lives in exactly one place, `UsersPage`, which holds one value for one row.
 * A cell that kept its own copy would still be holding a password after the
 * page handed the open row to another cell — closed on screen, remembered in
 * memory. Here, closing the row is the same event as forgetting the value.
 *
 * `value.password === null` has two very different cures, and the cell says
 * which: either the deployment has no key at all, or this one credential
 * predates the vault and a reissue fixes it.
 */
export function PasswordCell({
  isOpen,
  isPending,
  value,
  hasFailed,
  onToggle,
}: {
  /** Whether THIS row is the one being shown — the page allows one. */
  isOpen: boolean;
  isPending: boolean;
  value: RevealedPassword | null;
  hasFailed: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        // The row itself opens the edit dialog. Without this the eye would do
        // both, and the password would appear behind a modal.
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
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

      {isPending ? (
        <Spinner className="size-4" />
      ) : hasFailed ? (
        <span role="status" className="text-xs text-destructive">
          {t('users.password.failed')}
        </span>
      ) : value?.password ? (
        // `role="status"`: the button's label flips to «Сховати пароль», which
        // tells a screen-reader user that something changed but not what
        // appeared. `break-all` keeps a long password from widening the table
        // into a horizontal scroll on a phone; `select-all` grabs it in one
        // click, to read out or paste into a message.
        <span role="status" className="select-all break-all font-mono text-sm">
          {value.password}
        </span>
      ) : value ? (
        <span role="status" className="text-xs text-muted-foreground">
          {t(value.vault_enabled ? 'users.password.reissue' : 'users.password.vaultOff')}
        </span>
      ) : (
        <span aria-hidden="true" className="tracking-widest text-muted2">
          ••••
        </span>
      )}
    </div>
  );
}
