import { useCallback, useEffect, useState } from "react";
import { CircleAlertIcon, DownloadIcon, FileTextIcon } from "lucide-react";
import { BoxEditor } from "@/components/BoxEditor";
import { CompanyDetailsPanel } from "@/components/CompanyDetailsPanel";
import { DashboardDataNotice } from "@/components/DashboardDataNotice";
import { FieldForm } from "@/components/FieldForm";
import { NewTemplateFlow } from "@/components/NewTemplateFlow";
import { TemplateList } from "@/components/TemplateList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { readDashboardPayroll, type DashboardPayroll } from "@/lib/payrollHub";
import {
  deleteTemplate,
  getTemplate,
  listTemplates,
  renameTemplate,
} from "@/lib/template";
import type { Template } from "@/types/template";

type View =
  | { name: "home" }
  | { name: "new" }
  | { name: "company-details"; id: string }
  | { name: "edit-boxes"; id: string }
  | { name: "fill"; id: string };

function App() {
  const [view, setView] = useState<View>({ name: "home" });
  const [templates, setTemplates] = useState<Template[]>(() =>
    listTemplates(),
  );

  function refreshTemplates() {
    setTemplates(listTemplates());
  }

  // Everything below only ever does something inside the Payroll Hub
  // dashboard's frame: opened on its own, the bridge stays silent, nothing
  // is ever waiting, and none of the dashboard controls are rendered.
  const insideDashboard = window.PayrollHubBridge.isEmbedded();

  // Payroll results received from the dashboard and not imported yet. Kept
  // in this state and nowhere else — no browser storage, no logging — so a
  // page reload or Discard is the end of it.
  const [waitingPayroll, setWaitingPayroll] = useState<DashboardPayroll | null>(
    null,
  );
  // True once the import preview for the waiting data was closed without
  // importing; the notice then offers to open it again.
  const [previewClosed, setPreviewClosed] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Throws when the rows can't be used, which is what tells the dashboard
  // "Not delivered". Newer data replaces whatever was still waiting.
  const receivePayroll = useCallback(
    (payload: Parameters<typeof readDashboardPayroll>[0]) => {
      setWaitingPayroll(readDashboardPayroll(payload));
      setPreviewClosed(false);
      setDashboardError(null);
    },
    [],
  );

  useEffect(() => {
    window.PayrollHubBridge.init({ appId: "pdf-editor", onData: receivePayroll });
  }, [receivePayroll]);

  async function handleGetFromDashboard() {
    setRequesting(true);
    setDashboardError(null);
    const reply = await window.PayrollHubBridge.requestData("payroll-result");
    setRequesting(false);

    if (!reply.ok) {
      setDashboardError(`Nothing received: ${reply.error}`);
      return;
    }
    try {
      receivePayroll(reply);
    } catch (err) {
      setDashboardError(
        err instanceof Error
          ? `Nothing received: ${err.message}`
          : "Nothing received: this data couldn't be used.",
      );
    }
  }

  function discardWaitingPayroll() {
    setWaitingPayroll(null);
    setPreviewClosed(false);
  }

  const activeTemplate =
    view.name === "edit-boxes" ||
    view.name === "fill" ||
    view.name === "company-details"
      ? getTemplate(view.id)
      : undefined;

  useEffect(() => {
    const needsTemplate =
      view.name === "edit-boxes" ||
      view.name === "fill" ||
      view.name === "company-details";
    if (needsTemplate && !activeTemplate) {
      setView({ name: "home" });
    }
  }, [view, activeTemplate]);

  // BoxEditor/FieldForm save straight to localStorage without telling App,
  // so the list would otherwise show stale data (e.g. an old "last updated"
  // date) until something else happened to trigger a refresh.
  useEffect(() => {
    if (view.name === "home") {
      refreshTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // The import preview lives on a template's fill-in screen, and only once
  // that template has fields to import into.
  const canPreviewHere =
    view.name === "fill" && (activeTemplate?.boxes.length ?? 0) > 0;
  const waitingHint = !canPreviewHere
    ? view.name === "fill"
      ? "This template has no fields yet. Add fields, or open another template, to use it."
      : "Open a template to fill in, and you'll be asked before anything is imported."
    : previewClosed
      ? "Not imported yet."
      : "Check the preview to import it into this template.";

  return (
    <div className="relative isolate flex min-h-svh flex-col bg-canvas">
      {/* Soft colour washes and a faint grid behind the content, for depth.
          Only on screens with no PDF on them: wherever a document is
          previewed, the background stays plain. */}
      {(view.name === "home" || view.name === "company-details") && (
        <div aria-hidden="true" className="app-backdrop">
          <span />
          <span />
          <span />
        </div>
      )}
      <header className="border-b border-line bg-elevated">
        <div className="mx-auto flex max-w-296 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <div className="icon-tile size-9 rounded-lg">
            <FileTextIcon className="size-4.5" />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-fg">
            Statement of Emoluments Tool
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {insideDashboard && (
            <Button
              variant="outline"
              onClick={handleGetFromDashboard}
              disabled={requesting}
            >
              <DownloadIcon />
              {requesting ? "Waiting for the dashboard…" : "Get from dashboard"}
            </Button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center gap-6 px-4 py-8 sm:px-6">
        {dashboardError && (
          <p role="alert" className="notice-panel notice-danger w-full max-w-2xl">
            <CircleAlertIcon />
            {dashboardError}
          </p>
        )}

        {waitingPayroll && (
          <DashboardDataNotice
            data={waitingPayroll}
            hint={waitingHint}
            wide={view.name === "fill"}
            onReview={
              canPreviewHere && previewClosed
                ? () => setPreviewClosed(false)
                : undefined
            }
            onDiscard={discardWaitingPayroll}
          />
        )}

        {view.name === "home" && (
          <TemplateList
            templates={templates}
            onNewTemplate={() => setView({ name: "new" })}
            onFillTemplate={(id) => {
              // Opening a template to fill in is the moment to offer
              // whatever is waiting, even if its preview was closed earlier.
              setPreviewClosed(false);
              setView({ name: "fill", id });
            }}
            onEditTemplate={(id) => setView({ name: "edit-boxes", id })}
            onCompanyDetails={(id) => setView({ name: "company-details", id })}
            onRenameTemplate={(id, name) => {
              renameTemplate(id, name);
              refreshTemplates();
            }}
            onDeleteTemplate={(id) => {
              deleteTemplate(id);
              refreshTemplates();
            }}
          />
        )}

        {view.name === "company-details" && activeTemplate && (
          <CompanyDetailsPanel
            template={activeTemplate}
            onBack={() => setView({ name: "home" })}
          />
        )}

        {view.name === "new" && (
          <NewTemplateFlow
            onCreated={(template) => {
              refreshTemplates();
              setView({ name: "edit-boxes", id: template.id });
            }}
            onCancel={() => setView({ name: "home" })}
          />
        )}

        {view.name === "edit-boxes" && activeTemplate && (
          <BoxEditor
            template={activeTemplate}
            onBack={() => setView({ name: "home" })}
          />
        )}

        {view.name === "fill" && activeTemplate && (
          <FieldForm
            template={activeTemplate}
            onBack={() => setView({ name: "home" })}
            onEditFields={() =>
              setView({ name: "edit-boxes", id: activeTemplate.id })
            }
            dashboardData={previewClosed ? null : waitingPayroll}
            onDashboardImported={discardWaitingPayroll}
            onDashboardPreviewClosed={() => setPreviewClosed(true)}
          />
        )}
      </main>
    </div>
  );
}

export default App;
