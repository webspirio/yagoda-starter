import { BadRequestException } from '@nestjs/common';
import { add, gt, lt, lte, mul, sub, sum } from '../common/money';

/**
 * EVERY ARITHMETIC OPERATION IN THIS SLICE HAPPENS HERE, and nothing here
 * touches a database, a repository or a Nest context. That is deliberate: §2.4,
 * §2.8 and §2.9 are the rules most expensive to get wrong — a wrong `amount` is
 * frozen forever by §2.7 and printed on the supplier's copy — and they are
 * provable in milliseconds only if they live somewhere pure.
 *
 * The caller resolves the snapshots (current price per grade, weight per tare
 * type) and hands them in as maps. This module decides nothing about WHERE a
 * price comes from; it only refuses to proceed without one.
 */

export interface PriceSnapshot {
  base_price: string;
  /** Positive magnitudes: `max_markup = 30` means `bonus <= +30`,
   *  `max_discount = 20` means `bonus >= -20`. See the `grade_prices` entity. */
  max_markup: string;
  max_discount: string;
}

export interface TareSnapshot {
  id: string;
  weight_kg: string;
}

export interface IntakeLineInput {
  product_grade_id: string;
  gross_kg: string;
  pallet_kg: string;
  bonus: string;
  tare: { tare_type_id: string; units: number }[];
}

export interface BuiltLine {
  item_order: number;
  product_grade_id: string;
  gross_kg: string;
  pallet_kg: string;
  tare_weight_kg: string;
  net_kg: string;
  price: string;
  bonus: string;
  amount: string;
  tare: { tare_type_id: string; units: number }[];
}

export interface BuiltIntake {
  amount: string;
  items: BuiltLine[];
}

/** Declared as a `function` with an explicit `never` return so TypeScript's
 *  control-flow analysis treats a call as terminating — an arrow function
 *  assigned to a `const` does not narrow, which is what forced the
 *  `throw new Error('unreachable')` lines this replaces. */
function bad(message: string, code: string): never {
  throw new BadRequestException({ message, code });
}

export function buildIntake(
  inputs: IntakeLineInput[],
  prices: Map<string, PriceSnapshot>,
  tareTypes: Map<string, TareSnapshot>,
): BuiltIntake {
  const items = inputs.map((input, index) => buildLine(input, index + 1, prices, tareTypes));

  // §2.3 — `amount` is «те саме число, що надруковане на папері», and the paper
  // shows the lines above the total. Summing the ROUNDED line amounts is what
  // makes the printed total equal the printed lines; see money.spec.ts's
  // «Σ round(each) differs from round(Σ)».
  return { amount: sum(items.map((i) => i.amount)), items };
}

function buildLine(
  input: IntakeLineInput,
  item_order: number,
  prices: Map<string, PriceSnapshot>,
  tareTypes: Map<string, TareSnapshot>,
): BuiltLine {
  // §4.5 — «сорт без ціни дня на прийомці не показується взагалі». Enforced as
  // a refusal rather than left as a hope about what the client rendered.
  const price = prices.get(input.product_grade_id);
  if (!price) {
    bad(`No current price for grade ${input.product_grade_id} at this point`, 'GRADE_NOT_PRICED');
  }

  // §9.1 — «позиція без тари» is among the things the system «не дає провести
  // взагалі»: «Вкажіть кількість тари — без неї брутто пішло б у чисту вагу
  // цілком». §9.2 prices the omission at 20 010,00 ₴ on one 701,5 kg line and
  // notes it is «завжди на користь здавальника» — the error only ever runs one
  // way. The DTO refuses this first; this guards any non-HTTP caller.
  if (input.tare.length === 0) {
    bad(
      'every line must record its tare — without it the gross weight becomes net',
      'TARE_REQUIRED',
    );
  }

  // §6.3 — «a `tare_type_id` may appear at most once per item — that is the
  // composite primary key `(item_id, tare_type_id)`, so a repeated type is a
  // 400 BEFORE it is a 23505». Both entries would otherwise resolve against the
  // snapshot map and be summed, double-counting the units into
  // `tare_weight_kg`, and the cascade insert would then die on
  // `PK_intake_item_tare_types` — an error no `QueryFailedError` mapping in
  // this backend catches, so it would surface as a generic 500 on the one
  // route where an operator has a car waiting.
  const seen = new Set<string>();
  for (const t of input.tare) {
    if (seen.has(t.tare_type_id)) {
      bad(
        `tare type ${t.tare_type_id} is listed twice on one line — record it once with the total units`,
        'TARE_TYPE_DUPLICATED',
      );
    }
    seen.add(t.tare_type_id);
  }

  // §2.5 — «вага тари підставляється сама». Never typed, always derived from
  // the tare lines the same request carries.
  const tare_weight_kg = sum(
    input.tare.map((t) => {
      const type = tareTypes.get(t.tare_type_id);
      if (!type) bad(`Unknown or inactive tare type ${t.tare_type_id}`, 'TARE_TYPE_UNKNOWN');
      // `units` is an integer; `money.mul` parses an integer string exactly.
      return mul(type.weight_kg, String(t.units));
    }),
  );

  // §2.9 — the clamp. The prices slice added `max_markup`/`max_discount` for
  // exactly this and recorded that «nothing in this slice reads them». This is
  // the reader. Both are POSITIVE MAGNITUDES.
  //
  // THE MESSAGE NAMES THE RANGE. §2.10 («межа працює як обмеження, а не як
  // підказка») is a UI/UX recommendation about the resting state of the screen,
  // NOT a rule that the number is secret — the owner sees it, and the moment
  // someone exceeds it is exactly when it becomes relevant (owner, 2026-09-08).
  const floor = sub('0', price.max_discount);
  if (gt(input.bonus, price.max_markup) || lt(input.bonus, floor)) {
    bad(
      `bonus must be between ${floor} and ${price.max_markup} for this grade`,
      'BONUS_OUT_OF_RANGE',
    );
  }

  // §2.4 — PALLET FIRST, TARE SECOND. net = (gross − pallet) − tare.
  const net_kg = sub(sub(input.gross_kg, input.pallet_kg), tare_weight_kg);
  if (lte(net_kg, '0.00')) {
    bad(
      `net weight must be greater than 0 (gross ${input.gross_kg} − pallet ${input.pallet_kg} − tare ${tare_weight_kg} = ${net_kg})`,
      'NET_WEIGHT_NOT_POSITIVE',
    );
  }

  // A legal bonus can still drive the rate below zero on a cheaply priced
  // grade, because `max_discount` is an independent magnitude rather than a
  // fraction of the price. A negative rate on a positive weight is a document
  // that takes money FROM the supplier for delivering berries.
  const rate = add(price.base_price, input.bonus);
  if (lt(rate, '0.00')) {
    bad(
      `price + bonus must not be negative (${price.base_price} + ${input.bonus})`,
      'RATE_NEGATIVE',
    );
  }

  return {
    item_order,
    product_grade_id: input.product_grade_id,
    gross_kg: input.gross_kg,
    pallet_kg: input.pallet_kg,
    tare_weight_kg,
    net_kg,
    price: price.base_price,
    bonus: input.bonus,
    amount: mul(net_kg, rate),
    tare: input.tare,
  };
}
