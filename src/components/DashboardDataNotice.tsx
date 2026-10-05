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
  // As wide as the screen it sits above: the fill-in screen is wide, the
  // template list is narrower.
  wide: boolean;
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
  wide,
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
      className={`glass flex w-full flex-wrap items-center gap-3 border-accent/40 p-4 ${
        wide ? "max-w-296" : "max-w-4xl"
      }`}
    >
      <div className="icon-tile">
        <InboxIcon className="size-5" />
      </div>
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <span className="font-semibold text-fg">
          Payroll data from the dashboard is waiting
        </span>
        <span className="text-sm text-fg">{details.join(" · ")}</span>
        <span className="text-sm text-muted">{hint}</span>
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
