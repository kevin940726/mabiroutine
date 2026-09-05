// Floating-pill progress: the pill itself is the meter — a solid emerald
// layer fills the done share behind the content, no extra horizontal space.
// Emerald speaks the app's done-language (checked tiles are emerald-600);
// solid in both modes so text stays legible. The layer's width transitions
// exactly like the old bar did.
export function PillProgress({ pct }: { pct: number }) {
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 -z-10 bg-emerald-200 dark:bg-emerald-900 transition-all"
        style={{ width: `${pct}%` }}
      />
      <span className="font-bold shrink-0 text-xs">{pct}%</span>
    </>
  );
}
