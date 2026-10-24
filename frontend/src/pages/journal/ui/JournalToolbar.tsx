import { useTranslation } from 'react-i18next';
import { SelectField } from '@/shared/ui/select-field';
import { HeaderSlot } from '@/shared/ui/header-slot';
import { DateBound } from '@/shared/ui/date-bound';
import { Switch } from '@/shared/ui/switch';
import { TabsList, TabsTrigger } from '@/shared/ui/tabs';
import type { PointOption } from '@/entities/collection-point';
import { supplierName, type Supplier } from '@/entities/supplier';

/**
 * The journal's filter row: point, the «з»/«по» range, supplier, the «показувати
 * анульовані» switch, and the «Квитанції | Виплати» kind switch — the last
 * one is the kit's `Tabs` trigger list, its value/`onValueChange` owned by
 * the `Tabs` root the page mounts around this whole toolbar (see
 * `JournalPage`), not by this component.
 */
export function JournalToolbar({
  points,
  pointId,
  onPointChange,
  from,
  to,
  onFromChange,
  onToChange,
  suppliers,
  supplierId,
  onSupplierChange,
  includeVoided,
  onIncludeVoidedChange,
}: {
  points: PointOption[];
  pointId: string;
  onPointChange: (value: string) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  suppliers: Supplier[];
  supplierId: string;
  onSupplierChange: (value: string) => void;
  includeVoided: boolean;
  onIncludeVoidedChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <HeaderSlot slot="scope">
        <div className="w-44">
          <SelectField
            aria-label={t('journal.pickPoint')}
            value={pointId}
            onChange={(e) => onPointChange(e.target.value)}
          >
            <option value="">{t('journal.allPoints')}</option>
            {points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
        </div>
      </HeaderSlot>

      {/* Each bound caps the other, so the range cannot be reversed. */}
      <DateBound label={t('journal.pickFrom')} value={from} max={to} onCommit={onFromChange} />
      <DateBound label={t('journal.pickTo')} value={to} min={from} onCommit={onToChange} />

      <div className="w-52">
        <SelectField
          aria-label={t('journal.pickSupplier')}
          value={supplierId}
          onChange={(e) => onSupplierChange(e.target.value)}
        >
          <option value="">{t('journal.allSuppliers')}</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {supplierName(s)}
            </option>
          ))}
        </SelectField>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch checked={includeVoided} onCheckedChange={onIncludeVoidedChange} />
        {t('journal.showVoided')}
      </label>

      <TabsList className="ml-auto">
        <TabsTrigger value="intakes">{t('journal.kind.intakes')}</TabsTrigger>
        <TabsTrigger value="payouts">{t('journal.kind.payouts')}</TabsTrigger>
      </TabsList>
    </div>
  );
}
