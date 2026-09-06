import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Skeleton } from '@/shared/ui/skeleton';
import { useTareTypesQuery } from '../api/tareTypes';
import { TareTypeFormDialog } from './TareTypeFormDialog';
import type { TareType } from '../model/tareType';

/** Both numbers render as the strings the server sent — no formatting, no
 *  `toFixed`, no locale number formatter. The server already stores them at
 *  the scale it means, and reformatting is how a displayed value stops
 *  matching the one on the receipt. */
export function TareTypesTab() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useTareTypesQuery();
  const [editing, setEditing] = useState<TareType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so `TareTypeFormDialog` below remounts instead of
  // being reset by an effect: a fresh `key` gives it fresh `useForm` state
  // (seeded from `editing` at mount) and a fresh `formError`, whether this
  // open is a different tare type, the same one again, or create after edit —
  // with no effect needed to tell those cases apart.
  const [dialogInstance, setDialogInstance] = useState(0);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
    setDialogInstance((n) => n + 1);
  };
  const openEdit = (tare: TareType) => {
    setEditing(tare);
    setDialogOpen(true);
    setDialogInstance((n) => n + 1);
  };

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p role="alert" className="py-8 text-center text-destructive">
        {t('common.somethingWentWrong')}
      </p>
    );
  }

  const rows = data.data ?? [];
  const truncated = (data.total ?? 0) > rows.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>{t('catalog.tareTypes.add')}</Button>
      </div>

      {truncated && (
        <p role="status" className="text-sm text-destructive">
          {t('catalog.truncated', { shown: rows.length, total: data?.total })}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t('catalog.tareTypes.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.tareTypes.name')}</TableHead>
              <TableHead>{t('catalog.tareTypes.weight')}</TableHead>
              <TableHead>{t('catalog.tareTypes.deposit')}</TableHead>
              <TableHead>{t('catalog.tareTypes.isCrate')}</TableHead>
              <TableHead>{t('catalog.tareTypes.active')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((tare) => (
              <TableRow key={tare.id}>
                <TableCell>{tare.name}</TableCell>
                <TableCell>{tare.weight_kg}</TableCell>
                <TableCell>{tare.deposit_price}</TableCell>
                <TableCell>{tare.is_crate ? '✓' : '—'}</TableCell>
                <TableCell>
                  <Badge variant={tare.is_active ? 'default' : 'secondary'}>
                    {t(tare.is_active ? 'catalog.tareTypes.active' : 'catalog.tareTypes.inactive')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    aria-label={`${t('catalog.actions.edit')} ${tare.name}`}
                    onClick={() => openEdit(tare)}
                  >
                    {t('catalog.actions.edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <TareTypeFormDialog
        key={dialogInstance}
        open={dialogOpen}
        tareType={editing}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
