import { Tooltip } from "@/components/ui/tooltip";
import { formatEventEnd } from "@/lib/events";

export function EventTag({ endTime }: { endTime: string }) {
  const label = `活動至 ${formatEventEnd(endTime)}`;
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] whitespace-nowrap shrink-0 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
      >
        活動
      </button>
    </Tooltip>
  );
}
