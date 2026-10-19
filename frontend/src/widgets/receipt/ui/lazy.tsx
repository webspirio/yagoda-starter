import { lazy, Suspense, type ComponentProps } from 'react';

/*
 * The receipt dialogs, deferred from the first load. Both pull in the whole
 * paper (`shared/ui/receipt`, the builders, the void dialog) and neither is
 * on screen until a receipt is opened, so the eager screens (reception, day,
 * supplier card, debts) fetch them on the first opening instead of paying for
 * them up front — the `bundle` row's ceiling is a ratchet, and this is how a
 * feature makes the first load smaller rather than the ceiling larger.
 *
 * The chunk is requested only once there is an id to show: with `null` the
 * real dialogs render nothing anyway.
 */
const Intake = lazy(() => import('./ReceiptDialog').then((m) => ({ default: m.ReceiptDialog })));
const Payout = lazy(() =>
  import('./PayoutReceiptDialog').then((m) => ({ default: m.PayoutReceiptDialog })),
);

export function ReceiptDialog(props: ComponentProps<typeof Intake>) {
  if (props.intakeId === null) return null;
  return (
    <Suspense fallback={null}>
      <Intake {...props} />
    </Suspense>
  );
}

export function PayoutReceiptDialog(props: ComponentProps<typeof Payout>) {
  if (props.payoutId === null) return null;
  return (
    <Suspense fallback={null}>
      <Payout {...props} />
    </Suspense>
  );
}
