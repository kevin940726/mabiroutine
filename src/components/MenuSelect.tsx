import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuCheckboxItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type MenuOption = { value: string; label: string; icon?: ReactNode; group?: string };

// Shared dropdown-select built on non-modal DropdownMenu, NOT Radix Select:
// Select scroll-locks the body with no opt-out (shifts header/pill on
// mobile, double-locks inside modal dialogs). One pattern everywhere:
// barter filters + custom-task dialog (same non-modal pattern the character
// switchers use directly).
export function MenuSelect({ value, options, onChange, triggerClassName, placeholder, ariaLabel, contentClassName, triggerLabel }: {
  value: string;
  options: MenuOption[];
  onChange: (v: string) => void;
  triggerClassName?: string;
  placeholder?: string;
  /** Stable accessible name; without it the trigger is only named by its value. */
  ariaLabel?: string;
  contentClassName?: string;
  /** Overrides the displayed trigger text without touching the option list, so a
   *  compact surface (the floating pill) can read `城鎮` where the header reads
   *  `全部城鎮` from the same options. Falls back to the current option's label. */
  triggerLabel?: ReactNode;
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
          <span className="truncate">{triggerLabel ?? current?.label ?? placeholder ?? value}</span>
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

const TRIGGER_CLASS =
  "flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The same field and popup as MenuSelect, for a filter that takes any number of
 * values.
 *
 * Differences from the single-select: the popup lists the selected labels rather
 * than one active label, no option is "all" (an empty set means unfiltered, which
 * the trigger names 全部), every option is a checkbox, and the popup stays open
 * after a tick so a second value can be added without reopening it.
 *
 * An explicit 全部 row is offered because checkboxes have no other way back to
 * "no filter" — with a radio you pick the all option, with checkboxes you would
 * either tick everything or have to know that unticking the last one clears it.
 */
export function MenuMultiSelect({ values, options, onChange, triggerClassName, ariaLabel, contentClassName, triggerLabel }: {
  values: string[];
  options: MenuOption[];
  onChange: (v: string[]) => void;
  triggerClassName?: string;
  ariaLabel?: string;
  contentClassName?: string;
  /** Same compact-surface override as MenuSelect: `優先度` on a pill where the
   *  header would read `全部優先度`. Falls back to the selected labels. */
  triggerLabel?: ReactNode;
}) {
  const selected = options.filter((o) => values.includes(o.value));
  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={ariaLabel}
          className={cn(TRIGGER_CLASS, triggerClassName)}
        >
          <span className="truncate">
            {triggerLabel ?? (selected.length === 0 ? "全部優先度" : selected.map((o) => o.label).join("、"))}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("min-w-[max(9rem,var(--radix-dropdown-menu-trigger-width))]", contentClassName)}>
        <DropdownMenuCheckboxItem
          checked={values.length === 0}
          onSelect={(e) => {
            // keep the popup open: this row is a state, not a dismissal
            e.preventDefault();
            onChange([]);
          }}
          className="text-sm"
        >
          全部優先度
        </DropdownMenuCheckboxItem>
        {options.map((o, i) => (
          <div key={o.value}>
            {o.group != null && o.group !== options[i - 1]?.group && (
              <DropdownMenuLabel className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{o.group}</DropdownMenuLabel>
            )}
            <DropdownMenuCheckboxItem
              checked={values.includes(o.value)}
              onSelect={(e) => {
                e.preventDefault();
                toggle(o.value);
              }}
              className={cn("text-sm", o.icon && "gap-2")}
            >
              {o.icon}
              <span className="truncate">{o.label}</span>
            </DropdownMenuCheckboxItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
