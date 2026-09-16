import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/shared/ui/templates/list-page';
import type { Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useRevealPasswordMutation, useUsersQuery } from '../api/users';
import { UserFormDialog } from './UserFormDialog';
import { SetPasswordDialog } from './SetPasswordDialog';
import { PasswordCell } from './PasswordCell';
import type { AdminUser, RevealedPassword } from '../model/user';

export function UsersPage() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useUsersQuery();
  const { data: points } = usePointOptionsQuery();

  const [editing, setEditing] = useState<AdminUser | null>(null);

  /**
   * THE PASSWORD THE OWNER IS LOOKING AT, and there is only ever one. Held
   * here rather than per row (issue #11): the page is what decides which row
   * is open, so closing a row and forgetting its password are the same event.
   * A `PasswordCell` keeping its own copy would still be holding one after the
   * page had handed the open row to a different cell.
   */
  const reveal = useRevealPasswordMutation();
  const [openPasswordFor, setOpenPasswordFor] = useState<string | null>(null);
  const [password, setPassword] = useState<RevealedPassword | null>(null);
  const [failedPasswordFor, setFailedPasswordFor] = useState<string | null>(null);
  // Which press a resolving request belongs to. Open row A, then row B before
  // A answers, and without this A's password lands in B's cell — the owner
  // then reads out a password that cannot sign that person in.
  const pressSeq = useRef(0);

  const togglePassword = async (id: string) => {
    const press = ++pressSeq.current;
    const closing = openPasswordFor === id;
    setPassword(null);
    setFailedPasswordFor(null);
    setOpenPasswordFor(closing ? null : id);
    // `reset()` so the plaintext leaves the mutation cache with the row, not
    // at some later garbage collection.
    reveal.reset();
    if (closing) return;

    try {
      const result = await reveal.mutateAsync(id);
      if (pressSeq.current === press) setPassword(result);
    } catch {
      if (pressSeq.current === press) setFailedPasswordFor(id);
    }
  };
  const [formOpen, setFormOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  // Bumped on every open so each dialog remounts with fresh RHF defaults.
  const [formInstance, setFormInstance] = useState(0);
  const [passwordInstance, setPasswordInstance] = useState(0);

  const openCreate = () => {
    setEditing(null);
    setFormInstance((n) => n + 1);
    setFormOpen(true);
  };
  const openEdit = (user: AdminUser) => {
    setEditing(user);
    setFormInstance((n) => n + 1);
    setFormOpen(true);
  };
  const openResetPassword = () => {
    setFormOpen(false);
    setPasswordInstance((n) => n + 1);
    setPasswordOpen(true);
  };

  const rows = data?.data ?? [];
  const pointName = new Map((points ?? []).map((p) => [p.id, p.name]));

  const columns: Column<AdminUser>[] = [
    {
      id: 'name',
      header: t('users.col.name'),
      cell: (u) => <span className="font-medium">{u.display_name}</span>,
    },
    { id: 'login', header: t('users.col.login'), cell: (u) => u.login },
    {
      id: 'password',
      header: t('users.col.password'),
      // Fetched per press, never carried by the list response.
      cell: (u) => (
        <PasswordCell
          isOpen={openPasswordFor === u.id}
          isPending={openPasswordFor === u.id && reveal.isPending}
          value={openPasswordFor === u.id ? password : null}
          hasFailed={failedPasswordFor === u.id}
          onToggle={() => void togglePassword(u.id)}
        />
      ),
    },
    { id: 'role', header: t('users.col.role'), cell: (u) => t(`users.roleLabel.${u.role}`) },
    {
      id: 'point',
      header: t('users.col.point'),
      hideBelow: 'sm',
      cell: (u) => (u.collection_point_id ? (pointName.get(u.collection_point_id) ?? '—') : '—'),
    },
    {
      id: 'is_active',
      header: t('users.col.status'),
      align: 'right',
      cell: (u) => (
        <Badge variant={u.is_active ? 'default' : 'secondary'}>
          {u.is_active ? t('users.active') : t('users.inactive')}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <ListPage<AdminUser>
        eyebrow={t('users.eyebrow')}
        title={t('users.title')}
        description={t('users.description')}
        actions={<Button onClick={openCreate}>{t('users.new')}</Button>}
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        onRowClick={openEdit}
        isEmpty={!isPending && !isError && rows.length === 0}
        empty={<EmptyState title={t('users.empty.title')} hint={t('users.empty.hint')} />}
      >
        {isPending ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : isError ? (
          <p role="alert" className="py-6 text-center text-destructive">
            {t('common.somethingWentWrong')}
          </p>
        ) : undefined}
      </ListPage>

      <UserFormDialog
        key={`form-${formInstance}`}
        user={editing}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onResetPassword={openResetPassword}
      />

      <SetPasswordDialog
        key={`password-${passwordInstance}`}
        user={editing}
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
      />
    </>
  );
}
