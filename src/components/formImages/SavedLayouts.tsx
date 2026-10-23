import { useState } from "react";
import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  deleteLayout,
  listLayouts,
  saveLayout,
  type SavedLayout,
} from "@/lib/formImages/layouts";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Layouts saved in this browser: saving this form's boxes and margin
// under a name, loading one, deleting one.
export function SavedLayouts({
  makeLayout,
  onLoad,
  onMessage,
}: {
  // This form's boxes and margin, as a layout of this name.
  makeLayout: (name: string) => SavedLayout;
  onLoad: (layout: SavedLayout) => void;
  onMessage: (text: string) => void;
}) {
  const [layouts, setLayouts] = useState(listLayouts);
  const [name, setName] = useState("");
  // What the delete dialog was opened for, kept while it fades out.
  const [deleting, setDeleting] = useState<SavedLayout | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const trimmed = name.trim();
  const exists = layouts.some((layout) => layout.name === trimmed);

  function save() {
    if (!trimmed) return;
    const layout = makeLayout(trimmed);
    const saved = saveLayout(layout);
    setLayouts(listLayouts());
    onMessage(
      saved
        ? `Saved "${trimmed}" in this browser: ${count(layout.boxes.length, "box", "boxes")} and the full-page margin. The form and the images are not saved.`
        : `"${trimmed}" was NOT saved: the browser's storage for this tool is full. Delete a saved layout or a template you no longer need, then try again.`,
    );
  }

  function confirmDelete() {
    if (!deleting) return;
    if (!deleteLayout(deleting.name)) {
      onMessage(`"${deleting.name}" could not be deleted: the browser refused the change. Please try again.`);
    }
    setLayouts(listLayouts());
    setDeleteOpen(false);
  }

  return (
    <section className="glass flex flex-col">
      <div className="card-header">
        <h3 className="card-title">Saved layouts</h3>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">
          Boxes and the full-page margin, kept in this browser only, to use
          again on forms of the same kind.
        </p>
        {layouts.length === 0 ? (
          <p className="text-sm text-muted">No saved layouts yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {layouts.map((layout) => (
              <li
                key={layout.name}
                className="flex items-center gap-2 rounded-lg border border-line py-1 pr-1 pl-3"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-fg">{layout.name}</span>
                  <span className="text-xs text-muted">
                    {count(layout.boxes.length, "box", "boxes")}, for{" "}
                    {count(layout.pages.length, "page", "pages")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Load layout "${layout.name}"`}
                  onClick={() => onLoad(layout)}
                >
                  Load
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete layout "${layout.name}"`}
                  onClick={() => {
                    setDeleting(layout);
                    setDeleteOpen(true);
                  }}
                >
                  <Trash2Icon className="text-danger" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="layout-name" className="text-sm font-medium text-fg">
            Layout name
          </label>
          <div className="flex gap-2">
            <Input
              id="layout-name"
              value={name}
              placeholder="e.g. Form TM 1"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
              }}
            />
            <Button variant="outline" disabled={!trimmed} onClick={save}>
              {exists ? "Replace saved layout" : "Save layout"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader icon={<Trash2Icon />} tone="danger">
            <DialogTitle>Delete the saved layout?</DialogTitle>
            <DialogDescription>
              "{deleting?.name}" will be removed from this browser. No form or
              image is affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
