import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Shared dropdown-select built on non-modal DropdownMenu, NOT Radix Select:
// Select scroll-locks the body with no opt-out (shifts header/pill on
// mobile, double-locks inside modal dialogs). One pattern everywhere:
// barter filters + custom-task dialog (same non-modal pattern the character
// switchers use directly).
export function MenuSelect({ value, options, onChange, triggerClassName, placeholder, ariaLabel }: {
  value: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  onChange: (v: string) => void;
  triggerClassName?: string;
  placeholder?: string;
  /** Stable accessible name; without it the trigger is only named by its value. */
  ariaLabel?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={ariaLabel}
          className={cn(
            "flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            triggerClassName
          )}
        >
          <span className="truncate">{current?.label ?? placeholder ?? value}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[8rem]">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className={cn("text-sm", o.icon && "gap-2")}>
              {o.icon}
              <span className="truncate">{o.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
