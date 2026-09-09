/**
 * The demo dataset for manual testing — the mock CRM's season (`yagoda-crm`
 * `lib/seed.ts`), reduced to what the tables on `main` can hold: the ten
 * points from the client's own list plus the warehouse, the ten products and
 * their grades, the four tare types, one operator per working point, a
 * handful of suppliers per point, and a day price for every active grade at
 * every working point.
 *
 * NAMES ARE FICTIONAL. Operators and suppliers are the mock's pseudonyms; no
 * real person is in this file. Villages are real toponyms (not personal data)
 * and ride in `note`, since the starter's `suppliers` table has no village.
 *
 * MONEY IS A STRING, matching the wire and the `numeric` columns — nothing
 * here is ever a float. `price_offset` is per POINT, not per grade: «ціна на
 * кожну точку своя» — the further the point, the lower the price, and the
 * warehouse (`base`) buys at its own, higher price (§4.8).
 *
 * NO «ОПТ» GRADES, even though the mock carried (retired) ones: the schema
 * rejects them by design — `supplier.kind = wholesale` is a reporting marker,
 * and a grade with its own price would apply the same premium twice (see
 * `ProductGrade`'s doc comment). Two grades are seeded INACTIVE instead, so
 * the catalog's `include_inactive` filter has something to show.
 */

/** Every seeded operator signs in with this. The dev owner stays `admin`/`admin`. */
export const DEV_OPERATOR_PASSWORD = 'operator';

export interface SeedPoint {
  name: string;
  kind: 'reception' | 'base';
  is_active: boolean;
  target_cash: string | null;
  target_crates: number | null;
  /** Added to every grade's base price at this point. Signed, decimal string. */
  price_offset: string;
}

export const SEED_POINTS: readonly SeedPoint[] = [
  {
    name: 'Шипинки',
    kind: 'reception',
    is_active: true,
    target_cash: '145453.00',
    target_crates: 120,
    price_offset: '0',
  },
  {
    name: 'Конищів',
    kind: 'reception',
    is_active: true,
    target_cash: null,
    target_crates: 60,
    price_offset: '-5',
  },
  {
    name: 'Гайове',
    kind: 'reception',
    is_active: true,
    target_cash: '50000.00',
    target_crates: 40,
    price_offset: '-3',
  },
  {
    name: 'Попівці',
    kind: 'reception',
    is_active: true,
    target_cash: null,
    target_crates: null,
    price_offset: '-2',
  },
  {
    name: 'Михайлівці',
    kind: 'reception',
    is_active: true,
    target_cash: null,
    target_crates: null,
    price_offset: '-6',
  },
  {
    name: 'Склад',
    kind: 'base',
    is_active: true,
    target_cash: null,
    target_crates: null,
    price_offset: '5',
  },
  // In the registry, not yet opened — «від 5 до 10».
  {
    name: 'Журавлівка',
    kind: 'reception',
    is_active: false,
    target_cash: null,
    target_crates: null,
    price_offset: '0',
  },
  {
    name: 'Осламів',
    kind: 'reception',
    is_active: false,
    target_cash: null,
    target_crates: null,
    price_offset: '0',
  },
  {
    name: 'Зоряне',
    kind: 'reception',
    is_active: false,
    target_cash: null,
    target_crates: null,
    price_offset: '0',
  },
  {
    name: 'Дашківці',
    kind: 'reception',
    is_active: false,
    target_cash: null,
    target_crates: null,
    price_offset: '0',
  },
  {
    name: 'Войнашівка',
    kind: 'reception',
    is_active: false,
    target_cash: null,
    target_crates: null,
    price_offset: '0',
  },
];

/** Кизил has no grade on purpose — the mock's «товар без сортів» edge case. */
export const SEED_PRODUCTS: readonly string[] = [
  'Малина',
  'Вишня',
  'Смородина',
  'Порічка',
  'Ожина',
  'Суниця',
  'Бузина',
  'Шипшина',
  'Кизил',
  'Аронія',
];

export interface SeedGrade {
  product: string;
  name: string;
  is_active: boolean;
  /** Base price at the main point, ₴/kg. Verified pairs from the client's book: Ожина 60, Шипшина 35. */
  base_price: string;
}

export const SEED_GRADES: readonly SeedGrade[] = [
  { product: 'Малина', name: 'Вищий сорт', is_active: true, base_price: '140.00' },
  { product: 'Малина', name: '1 сорт', is_active: true, base_price: '130.00' },
  { product: 'Малина', name: '2 сорт', is_active: true, base_price: '115.00' },
  { product: 'Малина', name: '3 сорт', is_active: true, base_price: '95.00' },
  { product: 'Малина', name: 'Нестандарт', is_active: false, base_price: '70.00' },
  { product: 'Суниця', name: 'Стандарт', is_active: true, base_price: '90.00' },
  { product: 'Вишня', name: 'Стандарт', is_active: true, base_price: '35.00' },
  { product: 'Порічка', name: 'Стандарт', is_active: true, base_price: '50.00' },
  { product: 'Порічка', name: 'Дрібна', is_active: false, base_price: '40.00' },
  { product: 'Смородина', name: 'Стандарт', is_active: true, base_price: '45.00' },
  { product: 'Ожина', name: 'Стандарт', is_active: true, base_price: '60.00' },
  { product: 'Бузина', name: 'Стандарт', is_active: true, base_price: '25.00' },
  { product: 'Шипшина', name: 'Стандарт', is_active: true, base_price: '35.00' },
  { product: 'Аронія', name: 'Стандарт', is_active: true, base_price: '28.00' },
];

export interface SeedTareType {
  name: string;
  weight_kg: string;
  deposit_price: string;
  is_crate: boolean;
}

/** The client's `Data_Import!G/H/I` — Чешка stands in every one of its 1701 rows. */
export const SEED_TARE_TYPES: readonly SeedTareType[] = [
  { name: 'Чешка', weight_kg: '1.20', deposit_price: '120.00', is_crate: true },
  { name: 'Лубянка', weight_kg: '0.30', deposit_price: '50.00', is_crate: false },
  { name: 'Мішок', weight_kg: '0.10', deposit_price: '10.00', is_crate: false },
  { name: 'Ящик', weight_kg: '2.00', deposit_price: '20.00', is_crate: true },
];

export interface SeedOperator {
  /** Lowercase — `normalizeLogin` is what the login path applies. */
  login: string;
  first_name: string;
  last_name: string;
  point: string;
  is_active: boolean;
}

/** One operator per working point; Шипинки has two («точка Шипинки два касири»). */
export const SEED_OPERATORS: readonly SeedOperator[] = [
  { login: 'oksana', first_name: 'Оксана', last_name: 'Гнатюк', point: 'Шипинки', is_active: true },
  { login: 'maria', first_name: 'Марія', last_name: 'Савчук', point: 'Шипинки', is_active: true },
  { login: 'taras', first_name: 'Тарас', last_name: 'Бондар', point: 'Конищів', is_active: true },
  { login: 'ihor', first_name: 'Ігор', last_name: 'Вовк', point: 'Гайове', is_active: true },
  {
    login: 'bohdan',
    first_name: 'Богдан',
    last_name: 'Романюк',
    point: 'Попівці',
    is_active: true,
  },
  {
    login: 'lesia',
    first_name: 'Леся',
    last_name: 'Мельник',
    point: 'Михайлівці',
    is_active: true,
  },
  // Deactivated — so the users screen and the 401-on-next-request rule have a case.
  {
    login: 'petro',
    first_name: 'Петро',
    last_name: 'Ковальчук',
    point: 'Гайове',
    is_active: false,
  },
];

export interface SeedSupplier {
  point: string;
  first_name: string;
  last_name: string;
  /** E.164 or null — the client's book had no phones at all, so many are null. */
  phone: string | null;
  kind: 'none' | 'wholesale' | 'farmer';
  note: string | null;
  is_active: boolean;
}

export const SEED_SUPPLIERS: readonly SeedSupplier[] = [
  {
    point: 'Шипинки',
    first_name: 'Галина',
    last_name: 'Кушнірук',
    phone: '+380671000001',
    kind: 'wholesale',
    note: 'с. Копайгород · возить палетами',
    is_active: true,
  },
  {
    point: 'Шипинки',
    first_name: 'Христина',
    last_name: 'Каленчук',
    phone: null,
    kind: 'none',
    note: 'с. Копайгород',
    is_active: true,
  },
  {
    point: 'Шипинки',
    first_name: 'Тарас',
    last_name: 'Кирилюк',
    phone: '+380671000002',
    kind: 'wholesale',
    note: 'с. Копайгород',
    is_active: true,
  },
  {
    point: 'Шипинки',
    first_name: 'Ніна',
    last_name: 'Ільчук',
    phone: '+380671000003',
    kind: 'wholesale',
    note: 'с. Копайгород',
    is_active: true,
  },
  {
    point: 'Шипинки',
    first_name: 'Василь',
    last_name: 'Яремчук',
    phone: null,
    kind: 'none',
    note: 'с. Шипинки',
    is_active: true,
  },
  {
    point: 'Шипинки',
    first_name: 'Жанна',
    last_name: 'Осадчук',
    phone: '+380671000004',
    kind: 'wholesale',
    note: 'Здає за розпискою',
    is_active: true,
  },
  {
    point: 'Шипинки',
    first_name: 'Марія',
    last_name: 'Приймак',
    phone: '+380671000005',
    kind: 'none',
    note: null,
    is_active: true,
  },
  {
    point: 'Конищів',
    first_name: 'Дарія',
    last_name: 'Савчук',
    phone: '+380672000001',
    kind: 'wholesale',
    note: 'с. Конищів',
    is_active: true,
  },
  {
    point: 'Конищів',
    first_name: 'Михайло',
    last_name: 'Ткачук',
    phone: '+380672000002',
    kind: 'farmer',
    note: null,
    is_active: true,
  },
  {
    point: 'Конищів',
    first_name: 'Наталія',
    last_name: 'Пилипчук',
    phone: null,
    kind: 'none',
    note: 'с. Конищів',
    is_active: true,
  },
  {
    point: 'Гайове',
    first_name: 'Неля',
    last_name: 'Фурман',
    phone: '+380673000001',
    kind: 'wholesale',
    note: 'с. Гайове',
    is_active: true,
  },
  {
    point: 'Гайове',
    first_name: 'Григорій',
    last_name: 'Шевчук',
    phone: '+380673000002',
    kind: 'farmer',
    note: null,
    is_active: true,
  },
  {
    point: 'Гайове',
    first_name: 'Ірина',
    last_name: 'Уманець',
    phone: null,
    kind: 'none',
    note: 'с. Гайове',
    is_active: true,
  },
  {
    point: 'Попівці',
    first_name: 'Дарія',
    last_name: 'Нищук',
    phone: '+380674000001',
    kind: 'wholesale',
    note: 'с. Попівці',
    is_active: true,
  },
  {
    point: 'Попівці',
    first_name: 'Тарас',
    last_name: 'Швець',
    phone: null,
    kind: 'none',
    note: null,
    is_active: true,
  },
  {
    point: 'Михайлівці',
    first_name: 'Олена',
    last_name: 'Харчук',
    phone: '+380675000001',
    kind: 'wholesale',
    note: 'Возить палетами',
    is_active: true,
  },
  {
    point: 'Михайлівці',
    first_name: 'Руслана',
    last_name: 'Феськів',
    phone: null,
    kind: 'none',
    note: null,
    is_active: false,
  },
];

/** §2.9 — the network's ±30 ₴/kg bound on the per-line bonus, as two magnitudes. */
export const SEED_PRICE_LIMITS = { max_markup: '30.00', max_discount: '30.00' } as const;

export interface SeedPriceChange {
  point: string;
  product: string;
  grade: string;
  base_price: string;
  reason: string;
}

/**
 * Intraday corrections on the main point, so the append-only journal has a
 * second row to show («діє останній») and a `reason` to read.
 */
export const SEED_PRICE_CHANGES: readonly SeedPriceChange[] = [
  {
    point: 'Шипинки',
    product: 'Малина',
    grade: '1 сорт',
    base_price: '135.00',
    reason: 'Підняли — сусіди дають більше',
  },
  {
    point: 'Шипинки',
    product: 'Ожина',
    grade: 'Стандарт',
    base_price: '58.00',
    reason: 'Знизили — багато мякої ягоди',
  },
  {
    point: 'Шипинки',
    product: 'Смородина',
    grade: 'Стандарт',
    base_price: '47.00',
    reason: 'Ціна від переробника з обіду',
  },
];
