import { useEffect, useState } from "react";
import { FileTextIcon } from "lucide-react";
import { BoxEditor } from "@/components/BoxEditor";
import { FieldForm } from "@/components/FieldForm";
import { NewTemplateFlow } from "@/components/NewTemplateFlow";
import { SettingsPanel } from "@/components/SettingsPanel";
import { TemplateList } from "@/components/TemplateList";
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
  | { name: "settings" }
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

  const activeTemplate =
    view.name === "edit-boxes" || view.name === "fill"
      ? getTemplate(view.id)
      : undefined;

  useEffect(() => {
    const needsTemplate = view.name === "edit-boxes" || view.name === "fill";
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

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-6 py-4">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileTextIcon className="size-4.5" />
          </div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Statement of Emoluments Tool
          </h1>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
        {view.name === "home" && (
          <TemplateList
            templates={templates}
            onNewTemplate={() => setView({ name: "new" })}
            onOpenSettings={() => setView({ name: "settings" })}
            onFillTemplate={(id) => setView({ name: "fill", id })}
            onEditTemplate={(id) => setView({ name: "edit-boxes", id })}
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

        {view.name === "settings" && (
          <SettingsPanel onBack={() => setView({ name: "home" })} />
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
          />
        )}
      </main>
    </div>
  );
}

export default App;
