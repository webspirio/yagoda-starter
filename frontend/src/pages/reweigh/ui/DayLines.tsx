import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { Spinner } from '@/shared/ui/spinner';
import { formatShortDate, formatTime } from '@/shared/lib/date';
import { formatKg } from '@/shared/lib/money';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { useVoidReweighItemMutation } from '@/entities/reweigh';
import { useStaffQuery } from '@/entities/user';
import type { DayLine } from '../api/useDayReweighs';

const COLUMN_COUNT = 6;

/**
 * §8.7's table: every weighing recorded that DAY, across every point — the
 * ONLY surface a storno reaches from, and the ONLY surface a voided line
 * stays readable on («документ НЕ зникає»).
 *
 * A row is a LINE, not a document (this backend voids `POST
 * /reweigh-items/:id/void` one line at a time — see `useVoidReweighItemMutation`),
 * so the storno button on each row voids exactly that row. The reason row
 * beneath it is a second `<TableRow>`, inline, exactly the mock's shape
 * (`.reference/yagoda-crm/src/pages/ReweighPage.tsx:810-849`) — not a dialog.
 *
 * `useStaffQuery(true)`: this screen is owner-only (route-gated by Task 12),
 * so the reader is always allowed to ask `GET /users` for the name behind a
 * `voided_by_user_id`, including a since-deactivated author.
 */
export function DayLines({
  lines,
  isPending,
  date,
}: {
  lines: DayLine[];
  isPending: boolean;
  date: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const staff = useStaffQuery(true);
  const voidItem = useVoidReweighItemMutation();

  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [banner, setBanner] = useState<string | null>(null);

  function startVoid(id: string) {
    setVoidingId(id);
    setReason('');
    setBanner(null);
  }

  function cancelVoid() {
    setVoidingId(null);
    setReason('');
    setBanner(null);
  }

  async function confirmVoid(id: string) {
    try {
      await voidItem.mutateAsync({ id, reason: reason.trim() });
      setVoidingId(null);
      setReason('');
      setBanner(null);
    } catch (error) {
      setBanner(apiErrorToBanner(error, 'reweigh.day.errors.failed'));
    }
  }

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-3">
        <Eyebrow>{t('reweigh.day.title', { date: formatShortDate(date, locale) })}</Eyebrow>
        <span className="text-xs text-muted-foreground">{t('reweigh.day.allPoints')}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('reweigh.day.point')}</TableHead>
            <TableHead scope="col">{t('reweigh.day.time')}</TableHead>
            <TableHead scope="col">{t('reweigh.day.what')}</TableHead>
            <TableHead scope="col" className="text-right">
              {t('reweigh.day.ours')}
            </TableHead>
            <TableHead scope="col">{t('reweigh.day.status')}</TableHead>
            <TableHead scope="col">
              <span className="sr-only">{t('reweigh.day.actionHeader')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT}>
                <div className="flex justify-center py-6">
                  <Spinner />
                </div>
              </TableCell>
            </TableRow>
          ) : lines.length ? (
            lines.map(({ item, pointName }) => {
              const voided = item.voided_at !== null;
              const authorName =
                item.voided_by_user_id !== null ? (staff.data?.get(item.voided_by_user_id) ?? '') : '';
              // The visible button text is the same «Сторнувати»/"Void" on
              // every row — this table can carry every weighing recorded
              // NETWORK-WIDE for the day, so a screen reader landing on one
              // of N identical "Void" buttons (with an EMPTY action-column
              // header to fall back on, until the fix just above) has no way
              // to tell which line it is about to storno. The accessible
              // name, not the visible one, carries the point and the time —
              // see `reweigh.day.voidLine`.
              const voidLabel = t('reweigh.day.voidLine', {
                point: pointName,
                time: formatTime(item.created_at, locale),
              });
              return (
                <Fragment key={item.id}>
                  <TableRow className={voided ? 'text-muted-foreground' : undefined}>
                    <TableCell className="font-medium">{pointName}</TableCell>
                    <TableCell className="font-mono text-xs">{formatTime(item.created_at, locale)}</TableCell>
                    <TableCell>{item.product_grade_name ?? item.product_name ?? ''}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatKg(item.net_kg, locale)}
                    </TableCell>
                    <TableCell>
                      {item.voided_at !== null ? (
                        <span className="flex flex-wrap items-center gap-1.5 text-xs">
                          <Badge variant="outline">{t('reweigh.day.voided')}</Badge>
                          <span className="font-mono">{formatTime(item.voided_at, locale)}</span>
                          <span>· {authorName} ·</span>
                          <span className="italic">«{item.void_reason}»</span>
                        </span>
                      ) : (
                        <Badge variant="secondary">{t('reweigh.day.posted')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {voided ? null : (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={voidLabel}
                          onClick={() => startVoid(item.id)}
                        >
                          {t('reweigh.day.void')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {voidingId === item.id ? (
                    <TableRow className="bg-destructive/8 hover:bg-destructive/8">
                      <TableCell colSpan={COLUMN_COUNT}>
                        <div className="flex flex-wrap items-end gap-2">
                          <Field
                            name={`rw-reason-${item.id}`}
                            label={t('reweigh.day.reason')}
                            className="min-w-[240px] flex-1"
                          >
                            {(a11y) => (
                              <TextInput
                                {...a11y}
                                autoFocus
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder={t('reweigh.day.reasonPlaceholder')}
                                className="h-9"
                              />
                            )}
                          </Field>
                          <Button
                            variant="destructive"
                            aria-label={voidLabel}
                            disabled={!reason.trim() || voidItem.isPending}
                            onClick={() => confirmVoid(item.id)}
                          >
                            {t('reweigh.day.void')}
                          </Button>
                          <Button variant="ghost" onClick={cancelVoid}>
                            {t('reweigh.day.cancel')}
                          </Button>
                        </div>
                        {banner ? (
                          <p role="alert" className="mt-2 text-sm text-destructive">
                            {t(banner)}
                          </p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={COLUMN_COUNT} className="text-sm text-muted-foreground">
                {t('reweigh.day.empty')}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
