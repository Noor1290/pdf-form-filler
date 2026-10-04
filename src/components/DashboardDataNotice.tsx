import { InboxIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  companyNamesIn,
  formatPeriod,
  type DashboardPayroll,
} from "@/lib/payrollHub";

type DashboardDataNoticeProps = {
  data: DashboardPayroll;
  hint: string;
  // Only offered where the import preview can actually open (a template's
  // fill-in screen, after the preview was closed without importing).
  onReview?: () => void;
  onDiscard: () => void;
};

// Says exactly what is waiting from the dashboard — how many people, which
// month, which company — so held data is never a mystery, and gives a way
// to throw it away.
export function DashboardDataNotice({
  data,
  hint,
  onReview,
  onDiscard,
}: DashboardDataNoticeProps) {
  const details = [
    `${data.rows.length} ${data.rows.length === 1 ? "person" : "people"}`,
    data.period ? formatPeriod(data.period) : null,
    companyNamesIn(data.rows).join(", ") || null,
  ].filter(Boolean);

  return (
    <div
      role="status"
      className="flex w-full max-w-2xl items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3.5"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <InboxIcon className="size-5" />
      </div>
      <div className="flex flex-1 flex-col">
        <span className="font-medium text-foreground">
          Payroll data from the dashboard is waiting
        </span>
        <span className="text-sm text-foreground">{details.join(" · ")}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </div>
      <div className="flex shrink-0 gap-2">
        {onReview && (
          <Button size="sm" onClick={onReview}>
            Review and import
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onDiscard}>
          Discard
        </Button>
      </div>
    </div>
  );
}
