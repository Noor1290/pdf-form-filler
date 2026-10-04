import { useMemo, useRef, useState } from "react";
import { UploadIcon } from "lucide-react";
import {
  ImportPreviewDialog,
  type ImportPreview,
} from "@/components/ImportPreviewDialog";
import { Button } from "@/components/ui/button";
import {
  ImportFileError,
  parseImportFile,
  parseImportRows,
} from "@/lib/importEntries";
import {
  findCompanyMismatches,
  formatPeriod,
  type DashboardPayroll,
} from "@/lib/payrollHub";
import type { EmployerField, FieldBox } from "@/types/template";

type ImportEntriesDialogProps = {
  boxes: FieldBox[];
  employerFields: EmployerField[];
  existingEntryCount: number;
  onImport: (entries: Record<string, string>[], mode: "append" | "replace") => void;
  // Payroll results waiting from the Payroll Hub dashboard, if any. Always
  // null when the app is opened on its own.
  dashboardData: DashboardPayroll | null;
  onDashboardImported: () => void;
  onDashboardPreviewClosed: () => void;
};

function previewError(err: unknown, fallback: string): string {
  return err instanceof ImportFileError ? err.message : fallback;
}

// Separate from the manual "Add & fill next person" flow — lets someone
// bring in a whole payroll export at once instead of typing each person in
// by hand. Everything happens in the browser (read the file, match its
// columns to this template's fields, show what would be imported) with no
// server involved, same as the rest of the app. Rows sent by the dashboard
// are matched and previewed the same way a file's are.
export function ImportEntriesDialog({
  boxes,
  employerFields,
  existingEntryCount,
  onImport,
  dashboardData,
  onDashboardImported,
  onDashboardPreviewClosed,
}: ImportEntriesDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filePreview, setFilePreview] = useState<ImportPreview | null>(null);

  const dashboardPreview = useMemo<ImportPreview | null>(() => {
    if (!dashboardData) return null;
    const base = {
      key: dashboardData.id,
      description: dashboardData.period
        ? `From the dashboard, for ${formatPeriod(dashboardData.period)}`
        : "From the dashboard",
      source: "data" as const,
    };
    try {
      return {
        ...base,
        parsed: parseImportRows(dashboardData.rows, boxes),
        error: null,
        warnings: findCompanyMismatches(dashboardData.rows, employerFields),
      };
    } catch (err) {
      return {
        ...base,
        parsed: null,
        error: previewError(
          err,
          "Something went wrong reading this data. Please send it again.",
        ),
        warnings: [],
      };
    }
  }, [dashboardData, boxes, employerFields]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const base = {
      key: crypto.randomUUID(),
      description: `From "${file.name}"`,
      source: "file" as const,
      warnings: [],
    };
    try {
      const text = await file.text();
      setFilePreview({
        ...base,
        parsed: parseImportFile(file.name, text, boxes),
        error: null,
      });
    } catch (err) {
      setFilePreview({
        ...base,
        parsed: null,
        error: previewError(
          err,
          "Something went wrong reading this file. Please try again.",
        ),
      });
    }
  }

  // A file the user just picked is shown first; dashboard data keeps
  // waiting and is shown once that preview is closed.
  const showingFile = filePreview !== null;

  function handleImport(
    entries: Record<string, string>[],
    mode: "append" | "replace",
  ) {
    onImport(entries, mode);
    if (showingFile) setFilePreview(null);
    else onDashboardImported();
  }

  function handleClose() {
    if (showingFile) setFilePreview(null);
    else onDashboardPreviewClosed();
  }

  return (
    <>
      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
        <UploadIcon /> Import entries
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      <ImportPreviewDialog
        preview={filePreview ?? dashboardPreview}
        boxes={boxes}
        existingEntryCount={existingEntryCount}
        onImport={handleImport}
        onClose={handleClose}
      />
    </>
  );
}
