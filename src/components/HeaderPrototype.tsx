// PROTOTYPE — HeaderPrototype ?variant=o1|o2|o3 (DEV-only takeover in App).
// Mobile header today: 2 lines (~90px sticky), subtitle duplicates countdown.
// O1: one line — logo + title (no subtitle) + stacked countdown right + toggle.
// O2: countdown REPLACES the subtitle (live second line under title) + toggle.
// O3: logo-only — brand mark + countdown + toggle, no wordmark/subtitle.
import { useCountdown } from "@/hooks/useCountdown";
import { ThemeToggle } from "@/components/ThemeToggle";

export type HeaderVariant = "o1" | "o2" | "o3";

function StackedCountdown() {
  const { dailyText, weeklyText } = useCountdown();
  return (
    <span className="text-[11px] tabular-nums leading-tight text-muted-foreground text-right shrink-0">
      每日重置 <b className="text-foreground font-semibold">{dailyText}</b>
      <br />
      每週重置 <b className="text-foreground font-semibold">{weeklyText}</b>
    </span>
  );
}

function InlineCountdown() {
  const { dailyText, weeklyText } = useCountdown();
  return (
    <span className="text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
      每日 <b className="text-foreground font-semibold">{dailyText}</b> · 每週 <b className="text-foreground font-semibold">{weeklyText}</b>
    </span>
  );
}

const BLURB: Record<HeaderVariant, string> = {
  o1: "O1 — 單行：logo＋標題（無副標）＋右上堆疊倒數＋切換。",
  o2: "O2 — 倒數取代副標（標題下活的第二行）＋切換，header 單行高。",
  o3: "O3 — 只有 logo＋倒數＋切換，無字標最省。",
};

export function HeaderPrototype({ variant }: { variant: HeaderVariant }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-2 flex items-center gap-2">
          <img src="/logo-96.png" alt="MabiRoutine" className="h-8 w-8 object-contain shrink-0" />
          {variant === "o1" && <h1 className="text-base font-semibold leading-none shrink-0">MabiRoutine</h1>}
          {variant === "o2" && (
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-none">MabiRoutine</h1>
              <div className="mt-0.5"><InlineCountdown /></div>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {variant !== "o2" && (variant === "o1" ? <StackedCountdown /> : <InlineCountdown />)}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 py-4">
        <h2 className="text-base font-semibold">Header prototype — variant {variant.toUpperCase()}</h2>
        <p className="text-xs text-muted-foreground mt-1">{BLURB[variant]}</p>
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 rounded-lg border bg-card" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function HeaderSwitcher() {
  if (!import.meta.env.DEV) return null;
  const go = (x: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set("variant", x);
    window.location.href = u.toString();
  };
  return (
    <div className="fixed bottom-4 right-4 z-50 flex gap-1 rounded-full border bg-card p-1 shadow-lg">
      {(["o1", "o2", "o3"] as const).map((x) => (
        <button key={x} onClick={() => go(x)} className="h-9 px-2.5 rounded-full text-sm font-bold hover:bg-accent">
          {x.toUpperCase()}
        </button>
      ))}
      <button onClick={() => { const u = new URL(window.location.href); u.searchParams.delete("variant"); window.location.href = u.toString(); }} className="h-9 w-9 rounded-full text-sm hover:bg-accent" aria-label="exit prototype">✕</button>
    </div>
  );
}
