import { cn } from '@/shared/lib/cn';
import { Eyebrow } from './eyebrow';

/**
 * Місце під число, джерела для якого ще немає.
 *
 * ЧОМУ НЕ «—» І НЕ ПОРОЖНЕЧА. `—` у цьому продукті вже означає «наділу не
 * призначали»; той самий символ у другому значенні зробив би екран тихо
 * брехливим. Порожнеча вчить читача, що такої величини в продукті немає
 * взагалі. Тому — явний підпис: користувач бачить межу даних, а не баг, і
 * місце лишається зарезервованим під слайс ящиків.
 */
export function PendingSlice({
  label,
  note,
  variant = 'block',
}: {
  /** Що саме ще не рахується — «Каса за ящики». */
  label: string;
  /** Один рядок пояснення. */
  note: string;
  /** `inline` — для клітинки таблиці; `block` — для секції-картки. */
  variant?: 'inline' | 'block';
}) {
  if (variant === 'inline') {
    return (
      <span
        role="note"
        className="inline-flex max-w-full items-baseline gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground"
      >
        <span className="font-medium">{label}</span>
        <span className="truncate italic">{note}</span>
      </span>
    );
  }

  return (
    <div
      role="note"
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border border-dashed border-border p-4',
        'text-muted-foreground',
      )}
    >
      <Eyebrow>{label}</Eyebrow>
      <p className="text-sm italic">{note}</p>
    </div>
  );
}
