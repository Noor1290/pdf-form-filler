import { useState } from "react";
import { Building2Icon, FileStackIcon, PencilIcon, Trash2Icon } from "lucide-react";
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
import type { Template } from "@/types/template";

type TemplateListProps = {
  templates: Template[];
  onNewTemplate: () => void;
  onFillTemplate: (id: string) => void;
  onEditTemplate: (id: string) => void;
  onCompanyDetails: (id: string) => void;
  onRenameTemplate: (id: string, name: string) => void;
  onDeleteTemplate: (id: string) => void;
};

export function TemplateList({
  templates,
  onNewTemplate,
  onFillTemplate,
  onEditTemplate,
  onCompanyDetails,
  onRenameTemplate,
  onDeleteTemplate,
}: TemplateListProps) {
  const [renaming, setRenaming] = useState<Template | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<Template | null>(null);

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

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Your templates
          </h2>
          <p className="text-sm text-muted-foreground">
            Pick a template to fill in, or create a new one.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {templates.length > 0 && (
            <Button onClick={onNewTemplate}>New Template</Button>
          )}
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <FileStackIcon className="size-6 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium text-foreground">No templates yet</p>
            <p className="text-sm text-muted-foreground">
              Upload a PDF to create your first one.
            </p>
          </div>
          <Button className="mt-1" onClick={onNewTemplate}>
            Upload a PDF
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm transition-colors hover:border-primary/40"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <FileStackIcon className="size-5" />
              </div>
              <button
                type="button"
                onClick={() => onFillTemplate(template.id)}
                className="flex flex-1 flex-col items-start text-left"
              >
                <span className="font-medium text-foreground">
                  {template.name}
                </span>
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
                  onClick={() => onCompanyDetails(template.id)}
                >
                  <Building2Icon /> Company details
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startRename(template)}
                >
                  <PencilIcon /> Rename
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleting(template)}
                >
                  <Trash2Icon /> Delete
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
