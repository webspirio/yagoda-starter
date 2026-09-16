import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPage } from '@/shared/ui/templates/list-page';
import type { Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useUsersQuery } from '../api/users';
import { UserFormDialog } from './UserFormDialog';
import { SetPasswordDialog } from './SetPasswordDialog';
import { PasswordCell } from './PasswordCell';
import type { AdminUser } from '../model/user';

export function UsersPage() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useUsersQuery();
  const { data: points } = usePointOptionsQuery();

  const [editing, setEditing] = useState<AdminUser | null>(null);
  // One password on screen at a time — the id of the row whose eye is open.
  const [showingPasswordFor, setShowingPasswordFor] = useState<string | null>(null);
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
          user={u}
          isOpen={showingPasswordFor === u.id}
          onOpen={setShowingPasswordFor}
          onClose={() => setShowingPasswordFor(null)}
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
