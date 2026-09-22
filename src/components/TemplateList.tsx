import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { exportTemplateAsJson, importTemplateFromJson } from "@/lib/template";
import type { Template } from "@/types/template";

type TemplateListProps = {
  templates: Template[];
  onNewTemplate: () => void;
  onOpenSettings: () => void;
  onFillTemplate: (id: string) => void;
  onEditTemplate: (id: string) => void;
  onRenameTemplate: (id: string, name: string) => void;
  onDeleteTemplate: (id: string) => void;
  onImported: () => void;
};

export function TemplateList({
  templates,
  onNewTemplate,
  onOpenSettings,
  onFillTemplate,
  onEditTemplate,
  onRenameTemplate,
  onDeleteTemplate,
  onImported,
}: TemplateListProps) {
  const [renaming, setRenaming] = useState<Template | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Template | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  function startRename(template: Template) {
    setRenaming(template);
    setRenameValue(template.name);
  }

  function confirmRename() {
    if (!renaming) return;
    const trimmed = renameValue.trim();
    if (trimmed) onRenameTemplate(renaming.id, trimmed);
    setRenaming(null);
  }

  function confirmDelete() {
    if (!deleting) return;
    onDeleteTemplate(deleting.id);
    setDeleting(null);
  }

  async function handleImportFile(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      importTemplateFromJson(text);
      setImportError(null);
      onImported();
    } catch {
      setImportError(
        "This file doesn't look like a template — try exporting one from the templates list to see the right format.",
      );
    }
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Your templates</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onOpenSettings}>
            Employer details
          </Button>
          <Button variant="outline" onClick={() => importInputRef.current?.click()}>
            Import template
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImportFile}
          />
          {templates.length > 0 && (
            <Button onClick={onNewTemplate}>New Template</Button>
          )}
        </div>
      </div>

      {importError && (
        <p className="text-sm text-destructive">{importError}</p>
      )}

      {templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border p-10 text-center">
          <p className="text-muted-foreground">
            No templates yet — upload a PDF to create your first one.
          </p>
          <Button onClick={onNewTemplate}>Upload a PDF</Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
            >
              <button
                type="button"
                onClick={() => onFillTemplate(template.id)}
                className="flex flex-1 flex-col items-start text-left"
              >
                <span className="font-medium">{template.name}</span>
                <span className="text-sm text-muted-foreground">
                  Last updated{" "}
                  {new Date(template.updatedAt).toLocaleDateString()}
                </span>
              </button>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEditTemplate(template.id)}
                >
                  Edit fields
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportTemplateAsJson(template)}
                >
                  Export
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startRename(template)}
                >
                  Rename
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleting(template)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename template</DialogTitle>
            <DialogDescription>
              Choose a new name for "{renaming?.name}".
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={confirmRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete template?</DialogTitle>
            <DialogDescription>
              This will permanently delete "{deleting?.name}" and all its
              saved fields. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
