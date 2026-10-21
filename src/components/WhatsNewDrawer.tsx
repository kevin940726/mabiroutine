import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { formatMd, type WhatsNewKind, type WhatsNewView } from "@/lib/whatsNew";

const ARCHIVE_URL = "https://github.com/kevin940726/mabiroutine/blob/main/CHANGELOG-zh_TW.md";

const KIND_LABEL: Record<WhatsNewKind, string> = {
  feature: "新功能",
  fix: "修正",
};

export function WhatsNewDrawer({
  open,
  onOpenChange,
  view,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: WhatsNewView;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle>更新記錄</DrawerTitle>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-2">
          {view.groups.map((group) => (
            <section key={group.date} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 text-xs font-medium tabular-nums text-muted-foreground">
                {formatMd(group.date)}
              </h3>
              <ul className="flex flex-col gap-2">
                {group.releases.flatMap((release) =>
                  release.entries.map((entry, i) => (
                    <li
                      key={`${release.id}::${i}`}
                      className="flex gap-2 text-sm leading-relaxed"
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-fit w-[4.5em] shrink-0 items-center justify-center rounded py-0.5 text-[10px] font-medium leading-4",
                          entry.kind === "feature"
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {KIND_LABEL[entry.kind]}
                      </span>
                      <span>{entry.text}</span>
                    </li>
                  ))
                )}
              </ul>
            </section>
          ))}
          <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
            這份記錄也在{" "}
            <a
              href={ARCHIVE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              GitHub
            </a>
            {" "}上。
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
