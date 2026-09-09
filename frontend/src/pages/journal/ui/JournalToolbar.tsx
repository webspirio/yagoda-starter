import { useTranslation } from 'react-i18next';
import { SelectField } from '@/shared/ui/select-field';
import { TextInput } from '@/shared/ui/text-input';
import { Switch } from '@/shared/ui/switch';
import { TabsList, TabsTrigger } from '@/shared/ui/tabs';
import type { PointOption } from '@/entities/collection-point';
import { supplierName, type Supplier } from '@/entities/supplier';

/**
 * The journal's filter row: point, month, supplier, the «показувати
 * анульовані» switch, and the «Квитанції | Виплати» kind switch — the last
 * one is the kit's `Tabs` trigger list, its value/`onValueChange` owned by
 * the `Tabs` root the page mounts around this whole toolbar (see
 * `JournalPage`), not by this component.
 */
export function JournalToolbar({
  points,
  pointId,
  onPointChange,
  month,
  onMonthChange,
  suppliers,
  supplierId,
  onSupplierChange,
  includeVoided,
  onIncludeVoidedChange,
}: {
  points: PointOption[];
  pointId: string;
  onPointChange: (value: string) => void;
  month: string;
  onMonthChange: (value: string) => void;
  suppliers: Supplier[];
  supplierId: string;
  onSupplierChange: (value: string) => void;
  includeVoided: boolean;
  onIncludeVoidedChange: (value: boolean) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
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

      <div className="w-40">
        <TextInput
          type="month"
          aria-label={t('journal.pickMonth')}
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
        />
      </div>

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
