import { useState } from "react";
import {
  Building2Icon,
  FileStackIcon,
  PencilIcon,
  PenLineIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
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
    <div className="flex w-full max-w-4xl animate-rise flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-3xl font-semibold tracking-tight text-fg">
            Your templates
          </h2>
          <p className="text-sm text-muted">
            Pick a template to fill in, or create a new one.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {templates.length > 0 && (
            <Button onClick={onNewTemplate}>
              <PlusIcon />
              New Template
            </Button>
          )}
        </div>
      </div>

      {templates.length === 0 ? (
        <div className="glass flex flex-col items-center gap-4 px-6 py-14 text-center">
          <div className="icon-tile">
            <FileStackIcon className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-fg">No templates yet</p>
            <p className="text-sm text-muted">
              Upload a PDF to create your first one.
            </p>
          </div>
          <Button className="mt-1" onClick={onNewTemplate}>
            <UploadIcon />
            Upload a PDF
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {templates.map((template) => (
            <li
              key={template.id}
              className="glass flex flex-wrap items-center gap-x-4 gap-y-3 p-4 transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-line-strong"
            >
              {/* The whole left side opens the template to fill in. */}
              <button
                type="button"
                onClick={() => onFillTemplate(template.id)}
                className="flex min-w-56 flex-1 items-center gap-4 rounded-lg text-left"
              >
                <span className="icon-tile">
                  <FileStackIcon className="size-5" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate font-semibold text-fg">
                  {template.name}
                </span>
                <span className="text-sm text-muted tabular-nums">
                  Last updated{" "}
                  {new Date(template.updatedAt).toLocaleDateString()}
                </span>
                </span>
              </button>
              <div className="flex max-w-full flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEditTemplate(template.id)}
                >
                  <PenLineIcon />
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
          <DialogHeader icon={<PencilIcon />}>
            <DialogTitle>Rename template</DialogTitle>
            <DialogDescription>
              Choose a new name for "{renaming?.name}".
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Rename template"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
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
          <DialogHeader icon={<Trash2Icon />} tone="danger">
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
