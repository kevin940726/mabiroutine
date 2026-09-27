import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type MenuOption = { value: string; label: string; icon?: ReactNode; group?: string };

// Shared dropdown-select built on non-modal DropdownMenu, NOT Radix Select:
// Select scroll-locks the body with no opt-out (shifts header/pill on
// mobile, double-locks inside modal dialogs). One pattern everywhere:
// barter filters + custom-task dialog (same non-modal pattern the character
// switchers use directly).
export function MenuSelect({ value, options, onChange, triggerClassName, placeholder, ariaLabel, contentClassName }: {
  value: string;
  options: MenuOption[];
  onChange: (v: string) => void;
  triggerClassName?: string;
  placeholder?: string;
  /** Stable accessible name; without it the trigger is only named by its value. */
  ariaLabel?: string;
  contentClassName?: string;
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
      {/* Never narrower than the trigger: a popup narrower than the field that
          opened it reads as broken on desktop. */}
      <DropdownMenuContent align="start" className={cn("min-w-[max(9rem,var(--radix-dropdown-menu-trigger-width))]", contentClassName)}>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((o, i) => (
            <OptionRow key={o.value} option={o} showGroup={o.group != null && o.group !== options[i - 1]?.group} />
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A heading is emitted the first time a group appears, so grouped options
 *  need no wrapper and the radio group stays one flat keyboard context. */
function OptionRow({ option, showGroup }: { option: MenuOption; showGroup: boolean }) {
  return (
    <>
      {showGroup && <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{option.group}</DropdownMenuLabel>}
      <DropdownMenuRadioItem value={option.value} className={cn("text-sm", option.icon && "gap-2")}>
        {option.icon}
        <span className="truncate">{option.label}</span>
      </DropdownMenuRadioItem>
    </>
  );
}
