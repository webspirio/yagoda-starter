import { useEffect } from 'react';
import { useReducedMotion } from 'motion/react';
import type { Transition, Variants } from 'motion/react';

/**
 * The ONE motion vocabulary for the app. Every animated surface composes
 * these tokens instead of inventing ad-hoc springs — AAA feel = consistency.
 */
export const spring = {
  /**
   * The default. Bounce-free (critically damped) — no overshoot, settles
   * cleanly. Use for standard entrances, layout, sheets, page content.
   */
  smooth: { type: 'spring', bounce: 0, duration: 0.4 },
  /** Buttons, thumbs, checkmarks — fast and confident, a touch of overshoot. */
  snappy: { type: 'spring', stiffness: 400, damping: 30 },
  /** Calm, with a little character — pickers, expanding rows. */
  gentle: { type: 'spring', stiffness: 300, damping: 30 },
} satisfies Record<string, Transition>;

/**
 * The reduced-motion substitute for any transform-based transition: a ~150 ms
 * opacity cross-fade. Opacity/color/blur are NOT "motion" under WCAG 2.3.3, so
 * keep a soft cross-fade rather than a hard `duration: 0` cut (which reads as
 * broken). Reach for this at every reduced-motion branch.
 */
export const reducedFade: Transition = { duration: 0.15, ease: 'easeOut' };

/**
 * Timing for a REFUSAL — the shake or nudge a control gives when it declines an
 * input (a stepper at its cap, a form submitted with an invalid field).
 * Deliberately not a spring: a refusal is a there-and-back keyframe run with a
 * defined end, not a settle toward a new resting value, so the springs above
 * cannot express it. Pair with a keyframe array, e.g. `x: [0, -6, 6, -4, 4, 0]`.
 */
export const refusal: Transition = { duration: 0.4, ease: 'easeOut' };

/**
 * Spread onto any motion element for a tactile press:
 * `<motion.button {...pressScale} />`.
 * Prefer {@link usePressScale} at call sites so reduced-motion is handled.
 */
export const pressScale = {
  whileTap: { scale: 0.97 },
  transition: spring.snappy,
} as const;

/**
 * Reduced-motion-guarded press props. Spread onto any motion element:
 * `<motion.button {...usePressScale()} />`. Returns `{}` (no scale) when the
 * user prefers reduced motion, so no call site needs its own guard.
 */
export function usePressScale() {
  return useReducedMotionSafe() ? {} : pressScale;
}

/**
 * Parent variants for staggered list entrances. Children should use
 * `fadeSlideUp`. Trigger with `initial="hidden" animate="visible"` on first
 * mount only. Prefer {@link useListStagger} so reduced motion drops the stagger.
 */
export const listStagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04 } },
};

/** Reduced-motion-aware {@link listStagger}: drops the stagger delay to 0. */
export function useListStagger(): Variants {
  const reduced = useReducedMotionSafe();
  return reduced
    ? { hidden: {}, visible: { transition: { staggerChildren: 0 } } }
    : listStagger;
}

/** Child/page-content entrance: fade in while sliding up a touch. */
export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: spring.smooth },
};

/**
 * Reduced-motion-aware {@link fadeSlideUp}: drops the travel and cross-fades
 * over ~150 ms instead of a jump-cut. Use this at call sites so they never have
 * to hand-write a `duration: 0` reduced-motion branch again.
 */
export function useFadeSlideUp(): Variants {
  const reduced = useReducedMotionSafe();
  return reduced
    ? { hidden: { opacity: 0 }, visible: { opacity: 1, transition: reducedFade } }
    : fadeSlideUp;
}

/**
 * `useReducedMotion` that never returns null: `true` means the user asked for
 * reduced motion and every animated component MUST degrade (no transforms,
 * keep a soft opacity cross-fade via {@link reducedFade}). Defaults to `false`
 * where the preference is unknown (e.g. jsdom, old WebViews).
 */
export function useReducedMotionSafe(): boolean {
  return useReducedMotion() ?? false;
}

/**
 * App-load-scoped set of screens that have already played their entrance.
 * Module-level so it resets on reload — each app open replays entrances once.
 */
const enteredScreens = new Set<string>();

/**
 * Gate a screen's staggered entrance to its first mount this app-load. Feed the
 * return value to motion's `initial`: `'hidden'` on first view (animate in),
 * `false` on re-entry (render the `visible` state immediately — no
 * re-choreograph when navigating back to a screen you've already seen).
 */
export function useEntranceOnce(key: string): 'hidden' | false {
  const first = !enteredScreens.has(key);
  useEffect(() => {
    enteredScreens.add(key);
  }, [key]);
  return first ? 'hidden' : false;
}
