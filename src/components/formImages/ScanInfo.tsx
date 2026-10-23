import { SparklesIcon } from "lucide-react";
import type { PageCleaning } from "@/components/formImages/useScanCleaning";
import { Button } from "@/components/ui/button";

// Under a scanned page's number: how its cleaning went, the switch, and
// the before/after view.
export function ScanInfo({
  state,
  on,
  onSwitch,
  onCompare,
}: {
  state: PageCleaning | undefined;
  on: boolean;
  onSwitch: (on: boolean) => void;
  onCompare: () => void;
}) {
  if (!state || state.status === "working") {
    return <p className="text-xs text-muted" role="status">Cleaning this scan…</p>;
  }
  if (state.status === "failed") {
    return (
      <p className="text-xs text-muted" role="status">
        This scan couldn't be cleaned, so it goes into the PDF as scanned.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <label className="flex items-center gap-2 text-xs text-fg">
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          checked={on}
          onChange={(event) => onSwitch(event.target.checked)}
        />
        Clean this scan
      </label>
      <span className="text-xs text-muted" role="status">
        {on ? describe(state.cleaned.report) : "Not cleaned: the page goes into the PDF as scanned."}
      </span>
      <Button variant="outline" size="xs" onClick={onCompare}>
        <SparklesIcon />
        Compare before and after
      </Button>
    </div>
  );
}

function describe({ specks, edgeMarks }: { specks: number; edgeMarks: number }): string {
  const parts = ["paper made white"];
  if (specks > 0) parts.push(`${specks} ${specks === 1 ? "speck" : "specks"} removed`);
  if (edgeMarks > 0) {
    parts.push(`${edgeMarks} ${edgeMarks === 1 ? "mark" : "marks"} along the edge removed`);
  }
  return `Cleaned: ${parts.join(", ")}.`;
}
