// Floating-pill progress: the pill itself is the meter — a solid muted layer
// fills the done share behind the content, no extra horizontal space. The
// layer's width transitions exactly like the old bar did.
export function PillProgress({ pct }: { pct: number }) {
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 -z-10 bg-muted transition-all"
        style={{ width: `${pct}%` }}
      />
      <span className="font-bold shrink-0 text-xs">{pct}%</span>
    </>
  );
}
