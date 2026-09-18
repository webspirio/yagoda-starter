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
  /** Receipt-code prefix, 2–8 A–Z/0–9 (`collection_points.code`, intakes spec §6.2). */
  code: string;
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
    code: 'SHP',
    kind: 'reception',
    is_active: true,
    target_cash: '145453.00',
    target_crates: 120,
    price_offset: '0',
  },
  {
    name: 'Конищів',
    code: 'KON',
    kind: 'reception',
    is_active: true,
    target_cash: null,
    target_crates: 60,
    price_offset: '-5',
  },
  {
    name: 'Гайове',
    code: 'HAI',
    kind: 'reception',
    is_active: true,
    target_cash: '50000.00',
    target_crates: 40,
    price_offset: '-3',
  },
  {
    name: 'Попівці',
    code: 'POP',
    kind: 'reception',
    is_active: true,
    target_cash: null,
    target_crates: null,
    price_offset: '-2',
  },
  {
    name: 'Михайлівці',
    code: 'MYK',
    kind: 'reception',
    is_active: true,
    target_cash: null,
    target_crates: null,
    price_offset: '-6',
  },
  {
    name: 'Склад',
    code: 'BASE',
    kind: 'base',
    is_active: true,
    target_cash: null,
    target_crates: null,
    price_offset: '5',
  },
  // In the registry, not yet opened — «від 5 до 10».
  {
    name: 'Журавлівка',
    code: 'ZHU',
    kind: 'reception',
    is_active: false,
    target_cash: null,
    target_crates: null,
    price_offset: '0',
  },
  {
    name: 'Осламів',
    code: 'OSL',
    kind: 'reception',
    is_active: false,
    target_cash: null,
    target_crates: null,
    price_offset: '0',
  },
  {
    name: 'Зоряне',
    code: 'ZOR',
    kind: 'reception',
    is_active: false,
    target_cash: null,
    target_crates: null,
    price_offset: '0',
  },
  {
    name: 'Дашківці',
    code: 'DAS',
    kind: 'reception',
    is_active: false,
    target_cash: null,
    target_crates: null,
    price_offset: '0',
  },
  {
    name: 'Войнашівка',
    code: 'VOI',
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
  { name: 'Ящик', weight_kg: '2.00', deposit_price: '20.00', is_crate: false },
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
  /*
   * «ПОСТАВИТИ ВСІМ», ALREADY PRESSED — the state #89's sheet renders as a BARE
   * NUMBER in «Ціна дня загальна» rather than a range.
   *
   * Every other grade already disagrees across the network for free, because
   * each point carries a `price_offset` and the base seeding applies it: Малина
   * 1 сорт reads 124–135 with nothing added here. So the range branch was never
   * the gap — the AGREEMENT branch was, and no seeded grade could reach it.
   *
   * 150.00 is written ABSOLUTE at each of the five reception points (a change
   * row ignores `price_offset`, unlike the base row it corrects), so they agree
   * exactly. СКЛАД IS DELIBERATELY ABSENT: §4.8 — «склад це звичайний пункт
   * прийому зі своєю, вищою ціною, якого жест "поставити всім" НЕ чіпає». It
   * keeps its own 145.00 (140 base + its +5 offset), so the screen shows the
   * common price and the warehouse's separate one side by side, which is the
   * whole rule in one row.
   */
  {
    point: 'Шипинки',
    product: 'Малина',
    grade: 'Вищий сорт',
    base_price: '150.00',
    reason: 'Ціна дня загальна',
  },
  {
    point: 'Конищів',
    product: 'Малина',
    grade: 'Вищий сорт',
    base_price: '150.00',
    reason: 'Ціна дня загальна',
  },
  {
    point: 'Гайове',
    product: 'Малина',
    grade: 'Вищий сорт',
    base_price: '150.00',
    reason: 'Ціна дня загальна',
  },
  {
    point: 'Попівці',
    product: 'Малина',
    grade: 'Вищий сорт',
    base_price: '150.00',
    reason: 'Ціна дня загальна',
  },
  {
    point: 'Михайлівці',
    product: 'Малина',
    grade: 'Вищий сорт',
    base_price: '150.00',
    reason: 'Ціна дня загальна',
  },
];

/* ------------------------------------------------------------------------- *
 * Documents: shifts, intakes, payouts (the intakes & payouts slice).
 *
 * Yesterday on Шипинки is a CLOSED shift with four receipts and two payouts;
 * today is an OPEN shift there and on Конищів and Гайове, with receipts by
 * both cashiers of Шипинки. Попівці and Михайлівці have NO shift, so the
 * «open one first» state is reachable. Amounts are never written here: the
 * seed runs the server's own `buildIntake()` over the seeded prices and tare
 * weights, so what the demo stores is exactly what the API would have stored.
 * ------------------------------------------------------------------------- */

/**
 * A business date, relative to the day the seed runs. `'today'` and
 * `'yesterday'` name the two CURATED days; a NUMBER is that many days before
 * today, and is what `dev-seed.history.ts` generates with. The two spellings of
 * day 1 (`'yesterday'` and `1`) are deliberate: the curated rows keep the word,
 * so a reader can tell curated data from generated data without opening the
 * other file.
 */
export type SeedDay = 'today' | 'yesterday' | number;

/** `SeedDay` as a count of days before today. The one place the encoding lives. */
export function daysBack(day: SeedDay): number {
  if (day === 'today') return 0;
  if (day === 'yesterday') return 1;
  return day;
}

export interface SeedShift {
  point: string;
  day: SeedDay;
  /** Operator login who opened it (and closed it, when `closed`). */
  openedBy: string;
  closed: boolean;
}

export const SEED_SHIFTS: readonly SeedShift[] = [
  { point: 'Шипинки', day: 'yesterday', openedBy: 'oksana', closed: true },
  { point: 'Шипинки', day: 'today', openedBy: 'oksana', closed: false },
  { point: 'Конищів', day: 'today', openedBy: 'taras', closed: false },
  { point: 'Гайове', day: 'today', openedBy: 'ihor', closed: false },
];

export interface SeedIntakeLine {
  product: string;
  grade: string;
  gross_kg: string;
  pallet_kg: string;
  /** Signed, within the seeded ±30 bound. */
  bonus: string;
  tare: { type: string; units: number }[];
}

export interface SeedIntake {
  point: string;
  day: SeedDay;
  /** THE DATASET'S HANDLE FOR THIS DOCUMENT, not a stored value. It used to be
   *  the number the operator copied off the paper book, which the seed then
   *  prefixed into `code`; since 2026-09-18 the server numbers each shift
   *  itself and the seed does the same, so this survives only to let
   *  `SEED_TOP_UPS` name the receipt it tops up. */
  typed: string;
  /** `first_name last_name` of a seeded supplier at that point. */
  supplier: string;
  receivedBy: string;
  /** Local wall-clock time on the business date, HH:MM. */
  time: string;
  lines: SeedIntakeLine[];
}

export const SEED_INTAKES: readonly SeedIntake[] = [
  {
    point: 'Шипинки',
    day: 'yesterday',
    typed: '00412',
    supplier: 'Галина Кушнірук',
    receivedBy: 'oksana',
    time: '08:20',
    lines: [
      {
        product: 'Малина',
        grade: '1 сорт',
        gross_kg: '126.40',
        pallet_kg: '0.00',
        bonus: '0.00',
        tare: [{ type: 'Чешка', units: 12 }],
      },
    ],
  },
  {
    point: 'Шипинки',
    day: 'yesterday',
    typed: '00413',
    supplier: 'Христина Каленчук',
    receivedBy: 'oksana',
    time: '09:05',
    lines: [
      {
        product: 'Ожина',
        grade: 'Стандарт',
        gross_kg: '18.60',
        pallet_kg: '0.00',
        bonus: '0.00',
        tare: [{ type: 'Лубянка', units: 6 }],
      },
    ],
  },
  {
    point: 'Шипинки',
    day: 'yesterday',
    typed: '00414',
    supplier: 'Тарас Кирилюк',
    receivedBy: 'oksana',
    time: '11:40',
    lines: [
      {
        product: 'Малина',
        grade: 'Вищий сорт',
        gross_kg: '84.30',
        pallet_kg: '0.00',
        bonus: '5.00',
        tare: [{ type: 'Чешка', units: 8 }],
      },
      {
        product: 'Смородина',
        grade: 'Стандарт',
        gross_kg: '41.00',
        pallet_kg: '0.00',
        bonus: '0.00',
        tare: [{ type: 'Мішок', units: 4 }],
      },
    ],
  },
  {
    point: 'Шипинки',
    day: 'yesterday',
    typed: '00415',
    supplier: 'Жанна Осадчук',
    receivedBy: 'maria',
    time: '16:15',
    lines: [
      {
        product: 'Малина',
        grade: '2 сорт',
        gross_kg: '210.00',
        pallet_kg: '19.30',
        bonus: '-3.00',
        tare: [{ type: 'Чешка', units: 20 }],
      },
    ],
  },
  {
    point: 'Шипинки',
    day: 'today',
    typed: '00416',
    supplier: 'Галина Кушнірук',
    receivedBy: 'oksana',
    time: '07:55',
    lines: [
      {
        product: 'Малина',
        grade: '1 сорт',
        gross_kg: '98.70',
        pallet_kg: '0.00',
        bonus: '2.00',
        tare: [{ type: 'Чешка', units: 9 }],
      },
    ],
  },
  {
    point: 'Шипинки',
    day: 'today',
    typed: '00417',
    supplier: 'Марія Приймак',
    receivedBy: 'maria',
    time: '09:30',
    lines: [
      {
        product: 'Порічка',
        grade: 'Стандарт',
        gross_kg: '22.40',
        pallet_kg: '0.00',
        bonus: '0.00',
        tare: [{ type: 'Лубянка', units: 8 }],
      },
    ],
  },
  {
    point: 'Шипинки',
    day: 'today',
    typed: '00418',
    supplier: 'Ніна Ільчук',
    receivedBy: 'oksana',
    time: '10:45',
    lines: [
      {
        product: 'Малина',
        grade: '3 сорт',
        gross_kg: '150.00',
        pallet_kg: '18.00',
        bonus: '0.00',
        tare: [{ type: 'Чешка', units: 14 }],
      },
    ],
  },
  {
    point: 'Конищів',
    day: 'today',
    typed: '00071',
    supplier: 'Дарія Савчук',
    receivedBy: 'taras',
    time: '08:40',
    lines: [
      {
        product: 'Малина',
        grade: '1 сорт',
        gross_kg: '64.20',
        pallet_kg: '0.00',
        bonus: '0.00',
        tare: [{ type: 'Чешка', units: 6 }],
      },
    ],
  },
  {
    point: 'Конищів',
    day: 'today',
    typed: '00072',
    supplier: 'Михайло Ткачук',
    receivedBy: 'taras',
    time: '12:10',
    lines: [
      {
        product: 'Вишня',
        grade: 'Стандарт',
        gross_kg: '30.50',
        pallet_kg: '0.00',
        bonus: '0.00',
        tare: [{ type: 'Ящик', units: 3 }],
      },
    ],
  },
  {
    point: 'Гайове',
    day: 'today',
    typed: '00133',
    supplier: 'Неля Фурман',
    receivedBy: 'ihor',
    time: '09:15',
    lines: [
      {
        product: 'Ожина',
        grade: 'Стандарт',
        gross_kg: '44.80',
        pallet_kg: '0.00',
        bonus: '0.00',
        tare: [{ type: 'Лубянка', units: 14 }],
      },
      {
        product: 'Бузина',
        grade: 'Стандарт',
        gross_kg: '12.00',
        pallet_kg: '0.00',
        bonus: '0.00',
        tare: [{ type: 'Мішок', units: 2 }],
      },
    ],
  },
];

export interface SeedPayout {
  point: string;
  day: SeedDay;
  typed: string;
  supplier: string;
  paidBy: string;
  time: string;
  /** Kept well under the supplier's seeded receipts — the API's debt ceiling
   *  is real, and the db-spec proves no seeded balance goes negative. */
  amount: string;
}

export const SEED_PAYOUTS: readonly SeedPayout[] = [
  {
    point: 'Шипинки',
    day: 'yesterday',
    typed: '00088',
    supplier: 'Галина Кушнірук',
    paidBy: 'oksana',
    time: '17:30',
    amount: '10000.00',
  },
  {
    point: 'Шипинки',
    day: 'yesterday',
    typed: '00089',
    supplier: 'Тарас Кирилюк',
    paidBy: 'oksana',
    time: '17:35',
    amount: '5000.00',
  },
  {
    point: 'Шипинки',
    day: 'today',
    typed: '00090',
    supplier: 'Галина Кушнірук',
    paidBy: 'oksana',
    time: '11:00',
    amount: '4000.00',
  },
  {
    point: 'Гайове',
    day: 'today',
    typed: '00021',
    supplier: 'Неля Фурман',
    paidBy: 'ihor',
    time: '12:00',
    amount: '2000.00',
  },
];

export interface SeedCrateIssuance {
  point: string;
  supplier: string;
  /** Resolved to that point's seeded shift. */
  day: SeedDay;
  units: number;
  mode: 'deposit' | 'receipt';
  operator: string;
}

/**
 * Василь Яремчук holds TWO deposit tranches at DIFFERENT prices, so §6.5's
 * rule has a real case on a fresh database: the older one (issued yesterday,
 * at a price the catalogue no longer shows) is partially returned below and
 * the refund comes from IT, not from Чешка's current 120,00 ₴. Христина
 * Каленчук holds a receipt issuance so ticket #58's list is non-empty.
 */
export const SEED_CRATE_ISSUANCES: readonly SeedCrateIssuance[] = [
  { point: 'Шипинки', supplier: 'Василь Яремчук', day: 'yesterday', units: 20, mode: 'deposit', operator: 'oksana' },
  { point: 'Шипинки', supplier: 'Василь Яремчук', day: 'today', units: 20, mode: 'deposit', operator: 'oksana' },
  { point: 'Шипинки', supplier: 'Христина Каленчук', day: 'today', units: 200, mode: 'receipt', operator: 'oksana' },
];

export interface SeedCrateReturn {
  point: string;
  supplier: string;
  day: 'today';
  units: number;
  operator: string;
}

export const SEED_CRATE_RETURNS: readonly SeedCrateReturn[] = [
  { point: 'Шипинки', supplier: 'Василь Яремчук', day: 'today', units: 7, operator: 'oksana' },
];

export interface SeedTopUp {
  /** Addresses the parent exactly as `SEED_INTAKES` identifies itself. */
  point: string;
  day: SeedDay;
  typed: string;
  amount: string;
  reason: string;
}

/**
 * ONE TOP-UP, on YESTERDAY's Шипинки receipt — whose shift is CLOSED. That is
 * the #61 scenario exactly: the owner renegotiated after the fact, and by then
 * the shift was long shut. The card work that follows this slice needs a row
 * exercising the normal case, not an edge one.
 */
export const SEED_TOP_UPS: readonly SeedTopUp[] = [
  {
    point: 'Шипинки',
    day: 'yesterday',
    typed: '00412',
    amount: '750.00',
    reason: 'Домовились про 48 ₴/кг замість 45 ₴/кг після здачі',
  },
  /*
   * THREE MORE, ON RECEIPTS FROM THE GENERATED SEASON. One top-up proves the
   * mechanism; a supplier card whose timeline shows a SINGLE entry proves
   * nothing about how the screen reads when the owner has been renegotiating
   * all month. These address generated receipts by their generated codes, which
   * are stable across runs precisely because `dev-seed.history.ts` is
   * deterministic — if that ever stops being true, these stop resolving and the
   * seed throws «Seed top-up has no intake», which is the failure you want.
   */
  {
    point: 'Шипинки',
    day: 4,
    typed: 'H0400',
    amount: '1200.00',
    reason: 'Перерахували за домовленістю після здачі',
  },
  {
    point: 'Конищів',
    day: 6,
    typed: 'H0601',
    amount: '480.00',
    reason: 'Ціну підняли заднім числом, ягода пішла на переробку',
  },
  {
    point: 'Гайове',
    day: 9,
    typed: 'H0900',
    amount: '2000.00',
    reason: 'Домовились про доплату за обсяг',
  },
];

export interface SeedTransfer {
  point: string;
  day: SeedDay;
  /** Local wall-clock on that business date — also this row's natural key,
   *  since `transfers` has no `code` and no unique business column. */
  sentAt: string;
  cash: string;
  crates: number;
  carrier: string;
  /** `sent` leaves the «Прийняти» button live on the point's screen. */
  status: 'sent' | 'accepted' | 'disputed';
  /** Who signed for it, and when — required for `accepted` and `disputed`. */
  acceptedBy?: string;
  acceptedAt?: string;
  /**
   * `disputed` only, and all three together — «Не сходиться» writes the cash
   * counted, the crates counted AND the comment in one action, and
   * `DisputeTransferDto` makes every one of them mandatory (§7.9 step 4б).
   * Seeding a subset would store a row no route can produce: a dispute with a
   * NULL note is a number the owner cannot act on, and NULL crates make
   * `crates_discrepancy` come back `null` on the one document whose whole
   * point is that something did not add up.
   */
  reportedCash?: string;
  reportedCrates?: number;
  disputeNote?: string;
}

/**
 * The other half of §7.3's closed list — without these, every seeded point
 * pays out money it never received and reads as deeply negative.
 *
 * Шипинки yesterday is sized to fund that day's 15 000 in payouts and leave a
 * round 10 000 expected at close. One `sent` transfer at Гайове and one
 * `disputed` at Конищів exist so the two point actions have something to act
 * on the moment a developer signs in.
 */
export const SEED_TRANSFERS: readonly SeedTransfer[] = [
  {
    point: 'Шипинки',
    day: 'yesterday',
    sentAt: '08:10',
    cash: '20000.00',
    crates: 40,
    carrier: 'Іван, Ducato',
    status: 'accepted',
    acceptedBy: 'oksana',
    acceptedAt: '08:40',
  },
  {
    point: 'Шипинки',
    day: 'today',
    sentAt: '08:05',
    cash: '15000.00',
    crates: 30,
    carrier: 'Іван, Ducato',
    status: 'accepted',
    acceptedBy: 'oksana',
    acceptedAt: '08:35',
  },
  {
    point: 'Конищів',
    day: 'today',
    sentAt: '08:15',
    cash: '10000.00',
    crates: 20,
    carrier: 'Степан, Sprinter',
    // «Не сходиться»: 10 000 left the base, 9 800 arrived. Unresolved, so the
    // cash formula credits the point's OWN figure (client ruling 09.09.2026).
    status: 'disputed',
    acceptedBy: 'taras',
    acceptedAt: '08:45',
    reportedCash: '9800.00',
    // The crates DID add up — only the cash is short, which is what makes the
    // seeded dispute a one-dimensional case a developer can read at a glance.
    reportedCrates: 20,
    disputeNote: 'Перерахували при водієві: 9 800 ₴ замість 10 000. Ящики зійшлися.',
  },
  {
    point: 'Гайове',
    day: 'today',
    sentAt: '09:00',
    cash: '8000.00',
    crates: 15,
    carrier: 'Степан, Sprinter',
    // Still in the van — nothing it carries moves any cash (§7.9).
    status: 'sent',
  },
];

export interface SeedCashCount {
  point: string;
  day: SeedDay;
  kind: 'opening' | 'closing';
  time: string;
  countedBy: string;
  /**
   * A point's FIRST count only. It anchors the chain, so `expected = counted`
   * by construction and `drift` must be '0.00'.
   */
  anchor?: string;
  /**
   * Signed distance from the expectation the SERVER computes — the seed never
   * writes `expected` itself. '0.00' is a drawer that agrees.
   */
  drift: string;
}

/**
 * Every seeded shift is counted, because after the cash counts slice a shift
 * without an opening count has no anchor: `GET /point-cash` reports 0.00 and
 * closing it falls back to «expected = counted», hiding any real drift.
 *
 * Шипинки's close is 90 ₴ short ON PURPOSE. It is the only seeded incident,
 * and it is what makes `GET /cash-counts?only_discrepancies=true` — the
 * owner's working list — return something on a fresh database.
 */
export const SEED_CASH_COUNTS: readonly SeedCashCount[] = [
  // The network's day one at Шипинки: 5 000 in the drawer, and that figure
  // BECOMES the starting balance (client ruling 09.09.2026).
  {
    point: 'Шипинки',
    day: 'yesterday',
    kind: 'opening',
    time: '07:30',
    countedBy: 'oksana',
    anchor: '5000.00',
    drift: '0.00',
  },
  // 5 000 + 20 000 accepted − 15 000 paid out = 10 000 expected; 9 910 counted.
  {
    point: 'Шипинки',
    day: 'yesterday',
    kind: 'closing',
    time: '19:10',
    countedBy: 'oksana',
    drift: '-90.00',
  },
  // Today opens on yesterday's closing figure, and the drawer agrees with it —
  // §6.1's «має збігатися з залишком минулого закриття».
  {
    point: 'Шипинки',
    day: 'today',
    kind: 'opening',
    time: '07:30',
    countedBy: 'oksana',
    drift: '0.00',
  },
  {
    point: 'Конищів',
    day: 'today',
    kind: 'opening',
    time: '07:40',
    countedBy: 'taras',
    anchor: '3000.00',
    drift: '0.00',
  },
  {
    point: 'Гайове',
    day: 'today',
    kind: 'opening',
    time: '07:35',
    countedBy: 'ihor',
    anchor: '2500.00',
    drift: '0.00',
  },
];
