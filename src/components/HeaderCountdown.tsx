import { useCountdown } from "@/hooks/useCountdown";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Separator } from "@/components/ui/separator";

// Owns the 1/sec countdown tick so App (and every task list under it)
// doesn't re-render every second — ticks isolate to this header block.
export function HeaderCountdown() {
  const { dailyText, weeklyText } = useCountdown();
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <span className="text-[12px] tabular-nums leading-snug text-muted-foreground text-right shrink-0 whitespace-nowrap">
        每日重置 <b className="text-foreground font-semibold">{dailyText}</b>
        <br />
        每週重置 <b className="text-foreground font-semibold">{weeklyText}</b>
      </span>
    );
  }
  return (
    <div className="hidden sm:flex items-center gap-3 text-xs font-mono border rounded-full px-3 py-1.5 bg-card">
      <span>
        每日重置 <b>{dailyText}</b>
      </span>
      <Separator orientation="vertical" className="h-4" />
      <span>
        每週重置 <b>{weeklyText}</b>
      </span>
    </div>
  );
}
