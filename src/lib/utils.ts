import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Ref callback for rename inputs: focus + select-all exactly once, when the
// input mounts (i.e. on first entering edit mode). Module-level identity is
// the point: an inline `ref={(el) => el?.select()}` gets a fresh identity
// every render, so React detaches/re-attaches it on each keystroke and
// reselects all text (mobile: every tap types over the whole name). Likewise
// `onFocus={(e) => e.target.select()}` reselects on every keyboard show/hide.
export function focusSelectOnMount(el: HTMLInputElement | null) {
  el?.focus();
  el?.select();
}
