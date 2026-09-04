import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The one focus-visible ring for the app (Rule 3): pair with `outline-none`
 * on any custom-styled interactive element so keyboard focus is always
 * visible. Compose by name instead of re-deriving `focus-visible:ring-*`
 * per component.
 */
export const focusRing = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
