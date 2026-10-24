import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { ListPage } from '@/shared/ui/templates/list-page';
import type { Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { useClientSort } from '@/shared/ui/data-table-sort';
import { isTruncated } from '@/shared/api';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useUsersQuery } from '../api/users';
import { UserFormDialog } from './UserFormDialog';
import { SetPasswordDialog } from './SetPasswordDialog';
import type { AdminUser } from '../model/user';

export function UsersPage() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useUsersQuery();
  const { data: points } = usePointOptionsQuery();

  const [editing, setEditing] = useState<AdminUser | null>(null);

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

  const pointName = new Map((points ?? []).map((p) => [p.id, p.name]));
  const pointOf = (u: AdminUser) =>
    u.collection_point_id ? (pointName.get(u.collection_point_id) ?? null) : null;
  // What each sortable column orders by (#250) — the value, not the rendered cell.
  const { rows, sort, onSortChange } = useClientSort(
    data?.data ?? [],
    {
      number: (u) => u.number,
      name: (u) => u.display_name,
      login: (u) => u.login,
      role: (u) => t(`users.roleLabel.${u.role}`),
      point: pointOf,
      is_active: (u) => (u.is_active ? t('users.active') : t('users.inactive')),
    },
    { key: 'name', order: 'asc' },
  );

  const columns: Column<AdminUser>[] = [
    {
      id: 'number',
      header: t('users.col.number'),
      className: 'font-mono tabular-nums',
      // The receipt header's «Приймальник № N» (#250) — kept on narrow screens too.
      cell: (u) => u.number,
      sortable: true,
    },
    {
      id: 'name',
      header: t('users.col.name'),
      cell: (u) => <span className="font-medium">{u.display_name}</span>,
      sortable: true,
    },
    { id: 'login', header: t('users.col.login'), cell: (u) => u.login, sortable: true },
    {
      id: 'role',
      header: t('users.col.role'),
      cell: (u) => t(`users.roleLabel.${u.role}`),
      sortable: true,
    },
    {
      id: 'point',
      header: t('users.col.point'),
      hideBelow: 'sm',
      cell: (u) => pointOf(u) ?? '—',
      sortable: true,
    },
    {
      id: 'is_active',
      header: t('users.col.status'),
      align: 'right',
      sortable: true,
      // Rule 1 of the 2026-10-24 audit: berry is not «active». An active account is the
      // normal case and carries no badge; only a deactivated one is marked.
      cell: (u) => (u.is_active ? null : <Badge variant="outline">{t('users.inactive')}</Badge>),
    },
  ];

  return (
    <>
      <ListPage<AdminUser>
        eyebrow={t('users.eyebrow')}
        title={t('users.title')}
        description={t('users.description')}
        actions={
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            {t('users.new')}
          </Button>
        }
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        onRowClick={openEdit}
        sort={sort}
        onSortChange={onSortChange}
        footer={
          // The server caps a read at 100: past that the table — and its sort —
          // holds only the first page, so say so rather than look complete.
          isTruncated(data) ? (
            <p className="text-xs text-muted-foreground">
              {t('users.truncated', { shown: rows.length, total: data?.total })}
            </p>
          ) : undefined
        }
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
