import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CircleAlertIcon,
  DownloadIcon,
  FileTextIcon,
  HardDriveIcon,
  ImagesIcon,
  WifiOffIcon,
} from "lucide-react";
import { BoxEditor } from "@/components/BoxEditor";
import { CompanyDetailsPanel } from "@/components/CompanyDetailsPanel";
import { CopyToCompanyDialog } from "@/components/CopyToCompanyDialog";
import { DashboardBar } from "@/components/DashboardBar";
import { DashboardDataNotice } from "@/components/DashboardDataNotice";
import { FieldForm } from "@/components/FieldForm";
import { HistoryDialog } from "@/components/HistoryDialog";
import { ImportToDashboard } from "@/components/ImportToDashboard";
import { NewTemplateFlow } from "@/components/NewTemplateFlow";
import { SaveFailedDialog } from "@/components/SaveFailedDialog";
import { TemplateList } from "@/components/TemplateList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { formatLoadedAt, listCachedCopies } from "@/lib/dashboardCache";
import { readImported, templatesNotImported } from "@/lib/dashboardImport";
import {
  connectDashboard,
  dashboardCompany,
  dashboardLoadProblems,
  dashboardStatus,
  dashboardStore,
  offlineStore,
  openOfflineCopy,
} from "@/lib/dashboardStore";
import { readDashboardPayroll, type DashboardPayroll } from "@/lib/payrollHub";
import { setTemplateStore, templateStore } from "@/lib/templateStore";
import type { Template } from "@/types/template";

// The "Form & images" tool is separate from the templates, and only loaded
// when it is opened, so the screens used every day don't carry it.
const FormImagesTool = lazy(
  () => import("@/components/formImages/FormImagesTool"),
);

// Every read and save goes through the template store (lib/templateStore.ts).
const { deleteTemplate, getTemplate, listTemplates, renameTemplate } =
  templateStore;

// Where the templates are kept. On its own the tool always uses this
// browser. Inside the dashboard it asks the dashboard first: "starting"
// while it waits, "dashboard" once the templates are loaded from there,
// "failed" when they could not be, and "browser" when the dashboard is an
// older one that does not keep templates yet.
// "offline" is this browser's last copy of a company's templates from the
// dashboard, opened read-only because the dashboard could not be reached.
type Kept = "browser" | "starting" | "dashboard" | "failed" | "offline";

type View =
  | { name: "home" }
  | { name: "new" }
  | { name: "company-details"; id: string }
  | { name: "edit-boxes"; id: string }
  | { name: "fill"; id: string }
  | { name: "form-images" };

function App() {
  const [view, setView] = useState<View>({ name: "home" });
  const [templates, setTemplates] = useState<Template[]>(() => listTemplates());

  // A rename or delete the browser refused to store (see SaveFailedDialog).
  const [saveFailed, setSaveFailed] = useState(false);

  function refreshTemplates() {
    setTemplates(listTemplates());
  }

  const [kept, setKept] = useState<Kept>(
    window.PayrollHubBridge.isEmbedded() ? "starting" : "browser",
  );
  const [startProblem, setStartProblem] = useState("");
  // The template being copied to another company, if any.
  const [copying, setCopying] = useState<Template | null>(null);
  // The template whose history is open, if any.
  const [historyOf, setHistoryOf] = useState<Template | null>(null);
  // Which offline copy is open: whose templates, and from when.
  const [offlineCopy, setOfflineCopy] = useState<{
    label: string;
    loadedAt: string;
  } | null>(null);
  // True while the import dialog is open, so it can show its results.
  const [importOpen, setImportOpen] = useState(false);
  // Redrawn whenever a save to the dashboard starts, lands or fails.
  const saving = useSyncExternalStore(
    dashboardStatus.subscribe,
    dashboardStatus.get,
  );

  const loadFromDashboard = useCallback(async () => {
    setKept("starting");
    const result = await connectDashboard();
    if (result.ok) {
      setTemplateStore(dashboardStore);
      setKept("dashboard");
      setView({ name: "home" });
      setTemplates(templateStore.listTemplates());
    } else if (result.code === "not-supported") {
      setKept("browser");
    } else {
      setStartProblem(result.error);
      setKept("failed");
    }
  }, []);

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
    window.PayrollHubBridge.init({
      appId: "pdf-editor",
      onData: receivePayroll,
    });
  }, [receivePayroll]);

  // Inside the dashboard, the templates come from there. (After the bridge
  // has started, above: it carries the question.)
  useEffect(() => {
    if (window.PayrollHubBridge.isEmbedded()) void loadFromDashboard();
  }, [loadFromDashboard]);

  // A save that failed can put a template back in the list, and loading
  // another version changes one: the list follows.
  useEffect(() => {
    if (kept === "dashboard") setTemplates(templateStore.listTemplates());
  }, [kept, saving]);

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

  // The templates can be shown and worked on: not while they are still
  // being loaded from the dashboard, and not when that failed.
  const usable =
    kept === "browser" || kept === "dashboard" || kept === "offline";
  // The offline copy can be opened and filled in, and nothing else.
  const readOnly = kept === "offline";
  const company = kept === "dashboard" ? dashboardCompany() : null;
  // This browser's own templates that the dashboard does not have yet.
  const notImported =
    kept === "dashboard" && view.name === "home"
      ? templatesNotImported().length
      : 0;
  // On its own, after an import: say plainly which copy this is.
  const importedBefore =
    kept === "browser" && Object.keys(readImported()).length > 0;

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
            PDF Form Filler
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {insideDashboard && (
              <Button
                variant="outline"
                onClick={handleGetFromDashboard}
                disabled={requesting}
              >
                <DownloadIcon />
                {requesting
                  ? "Waiting for the dashboard…"
                  : "Get from dashboard"}
              </Button>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center gap-6 px-4 py-8 sm:px-6">
        {dashboardError && (
          <p
            role="alert"
            className="notice-panel notice-danger w-full max-w-2xl"
          >
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

        {kept === "starting" && (
          <p role="status" className="text-sm text-muted">
            Loading the templates from the dashboard…
          </p>
        )}

        {kept === "failed" && (
          <div
            role="alert"
            className="notice-panel notice-danger w-full max-w-2xl flex-wrap items-center"
          >
            <CircleAlertIcon />
            <span className="min-w-48 flex-1">
              The templates could not be loaded from the dashboard.{" "}
              {startProblem} Nothing was changed. The templates kept in this
              browser can still be used by opening this tool on its own, in a
              new tab.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadFromDashboard()}
            >
              Try again
            </Button>
          </div>
        )}

        {kept === "failed" &&
          listCachedCopies().map((copy) => (
            <div
              key={copy.brn}
              className="glass flex w-full max-w-2xl flex-wrap items-center gap-3 p-4"
            >
              <div className="icon-tile">
                <WifiOffIcon className="size-5" />
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-0.5">
                <span className="font-semibold text-fg">
                  {copy.label}: a copy from {formatLoadedAt(copy.loadedAt)}
                </span>
                <span className="text-sm text-muted">
                  The last one this browser loaded from the dashboard. It can be
                  opened to fill in and download, not to change.
                </span>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  const opened = openOfflineCopy(copy.brn);
                  if (!opened) return;
                  setTemplateStore(offlineStore);
                  setOfflineCopy(opened);
                  setKept("offline");
                  setView({ name: "home" });
                  setTemplates(templateStore.listTemplates());
                }}
              >
                Open the offline copy of {copy.label}
              </Button>
            </div>
          ))}

        {kept === "offline" && offlineCopy && (
          <div
            role="status"
            className={`notice-panel notice-warn w-full flex-wrap items-center ${
              view.name === "fill" ? "max-w-296" : "max-w-4xl"
            }`}
          >
            <WifiOffIcon />
            <span className="min-w-48 flex-1">
              <strong>
                Offline: read-only copy from{" "}
                {formatLoadedAt(offlineCopy.loadedAt)}. Changes can't be saved.
              </strong>{" "}
              These are the templates of {offlineCopy.label}. You can fill them
              in and download the PDF.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadFromDashboard()}
            >
              Try the dashboard again
            </Button>
          </div>
        )}

        {kept === "dashboard" && company && (
          <DashboardBar
            company={company}
            loadProblems={dashboardLoadProblems()}
            wide={view.name === "fill" || view.name === "edit-boxes"}
            onReload={() => void loadFromDashboard()}
          />
        )}

        {kept === "dashboard" &&
          company?.role === "admin" &&
          view.name === "home" &&
          (notImported > 0 || importOpen) && (
            <ImportToDashboard
              waiting={notImported}
              companyName={company.label}
              onImported={refreshTemplates}
              onOpenChange={setImportOpen}
            />
          )}

        {kept === "browser" && view.name === "home" && importedBefore && (
          <p className="notice-panel notice-warn w-full max-w-4xl">
            <HardDriveIcon />
            This browser only. Not the dashboard's copy.
          </p>
        )}

        {usable && view.name === "home" && (
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
              if (!renameTemplate(id, name)) setSaveFailed(true);
              refreshTemplates();
            }}
            onDeleteTemplate={(id) => {
              if (!deleteTemplate(id)) setSaveFailed(true);
              refreshTemplates();
            }}
            onRestored={refreshTemplates}
            onCopyTemplate={
              kept === "dashboard"
                ? (id) => setCopying(getTemplate(id) ?? null)
                : undefined
            }
            onHistory={
              kept === "dashboard"
                ? (id) => setHistoryOf(getTemplate(id) ?? null)
                : undefined
            }
            readOnly={readOnly}
          />
        )}

        {usable && view.name === "home" && (
          <section className="glass flex w-full max-w-4xl animate-rise flex-wrap items-center gap-4 p-4">
            <div className="icon-tile">
              <ImagesIcon className="size-5" />
            </div>
            <div className="flex min-w-48 flex-1 flex-col gap-0.5">
              <h2 className="font-semibold text-fg">Form & images</h2>
              <p className="text-sm text-muted">
                Put images such as a logo in boxes on any form, add full-page
                images at the end, and download one PDF.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => setView({ name: "form-images" })}
            >
              Open Form & images
            </Button>
          </section>
        )}

        {view.name === "form-images" && (
          <Suspense
            fallback={
              <div
                aria-hidden="true"
                className="skeleton h-40 w-full max-w-296 rounded-lg"
              />
            }
          >
            <FormImagesTool onBack={() => setView({ name: "home" })} />
          </Suspense>
        )}

        {usable && view.name === "company-details" && activeTemplate && (
          <CompanyDetailsPanel
            template={activeTemplate}
            onBack={() => setView({ name: "home" })}
          />
        )}

        {usable && view.name === "new" && (
          <NewTemplateFlow
            onCreated={(template) => {
              refreshTemplates();
              setView({ name: "edit-boxes", id: template.id });
            }}
            onCancel={() => setView({ name: "home" })}
          />
        )}

        {usable && view.name === "edit-boxes" && activeTemplate && (
          <BoxEditor
            template={activeTemplate}
            onBack={() => setView({ name: "home" })}
          />
        )}

        {usable && view.name === "fill" && activeTemplate && (
          <FieldForm
            template={activeTemplate}
            onBack={() => setView({ name: "home" })}
            onEditFields={() =>
              setView({ name: "edit-boxes", id: activeTemplate.id })
            }
            dashboardData={previewClosed ? null : waitingPayroll}
            onDashboardImported={discardWaitingPayroll}
            onDashboardPreviewClosed={() => setPreviewClosed(true)}
            readOnly={readOnly}
          />
        )}
      </main>

      <CopyToCompanyDialog
        template={copying}
        onClose={() => setCopying(null)}
      />

      <HistoryDialog
        template={historyOf}
        companyName={company?.label ?? ""}
        canRestore={company?.role === "admin"}
        onRestored={refreshTemplates}
        onClose={() => setHistoryOf(null)}
      />

      <SaveFailedDialog
        open={saveFailed}
        onClose={() => setSaveFailed(false)}
      />
    </div>
  );
}

export default App;
