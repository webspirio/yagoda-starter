import { CreateIntakeDto } from './create-intake.dto';

/**
 * `PreviewIntakeDto` IS `CreateIntakeDto` — one class, under the name each
 * route reads best.
 *
 * It was a separate class for as long as `CreateIntakeDto` carried `code`:
 * everything the server needed to COMPUTE a receipt, and nothing it needed
 * only to RECORD one. The reception screen shows net weight, price, bonus and
 * the line and document amounts live as the operator types, and §2.4/§2.8/§2.9
 * make the server the only place those may be computed, so the client asks for
 * the numbers without asking for a document — and the receipt number was
 * irrelevant to that answer, since nothing about `code` changes a weight or an
 * amount.
 *
 * On 2026-09-18 `code` left `CreateIntakeDto` too (the server numbers the
 * shift itself), and the two shapes became identical. Keeping two classes
 * would mean two validation surfaces that must be edited in lockstep, so this
 * is an alias. The ALIAS rather than the reverse, and the file rather than a
 * bare import at each call site, because the distinction is still real at the
 * route: `POST /intakes/preview` returns numbers and writes nothing.
 */
export { CreateIntakeDto as PreviewIntakeDto };
