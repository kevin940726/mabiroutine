import { useState, type ImgHTMLAttributes } from "react";

/**
 * An art `<img>` whose failure is TERMINAL: one error swaps in `fallbackSrc`,
 * and that render carries no `onError`, so nothing can re-enter a load.
 *
 * That is the entire point. An `onError` that ASSIGNS `img.src` (the pattern
 * this component replaces) is unbounded: when the fallback target is itself
 * missing, the assignment re-runs the load, the second failure re-enters the
 * same handler, and the pair loops forever. Measured 2026-10-12 in Chromium
 * with the edge's RTT simulated: the unguarded form fired 161 loads in 10s at
 * 50ms (rate set by latency, not by any cap), while the guarded form stopped
 * after 2. One looping `<img>` is ~7-16 requests/s, i.e. 300k-800k edge
 * requests across the 13.5 hours between the deploy that deleted its fallback
 * and the team being paused for exhausting the Hobby plan's 1M/month Edge
 * Requests (`docs/item-icons.md` § The fallback rule).
 *
 * State, not a URL swap, is what makes it terminal: React re-renders the
 * element once with the failure latched, and a broken fallback then just sits
 * broken instead of retrying. The same shape is what `NpcFace` and `ItemIcon`
 * already use for their own designed fallbacks.
 *
 * The latch is keyed by `src`, not by instance, because the element can be
 * REUSED with a different URL (the material-breakdown hover card renders one
 * per trigger): a new URL has to get its own attempt, while the URL that failed
 * can never be retried. A plain boolean would leave a reused instance showing
 * the placeholder for a healthy portrait.
 *
 * `fallbackSrc` is required, and must be a path that ships in the SAME deploy
 * as this code: the fallback is the last line, so it cannot itself be the
 * missing thing. `pnpm test:fallbacks` pins both halves of that contract — the
 * art paths resolve to files, and nothing outside `scripts/` assigns a `src`.
 */
export function ArtImg({
  src,
  fallbackSrc,
  ...rest
}: { src: string; fallbackSrc: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError">) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;
  return (
    <img
      {...rest}
      src={failed ? fallbackSrc : src}
      onError={failed ? undefined : () => setFailedSrc(src)}
    />
  );
}
