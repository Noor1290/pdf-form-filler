import type { ReactNode } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SaveFailedDialogProps = {
  open: boolean;
  onClose: () => void;
  // What this means on the screen it is shown from. Left out, the dialog
  // says the change was not kept, which is true of every screen whose Save
  // button reports the failure straight away.
  children?: ReactNode;
};

// Shown when the browser refuses to store a change (its storage for this
// site is full). It stays up until it is acknowledged, so a save that did
// not happen is never taken for one that did.
export function SaveFailedDialog({
  open,
  onClose,
  children,
}: SaveFailedDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      disablePointerDismissal
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader icon={<TriangleAlertIcon />} tone="danger">
          <DialogTitle>This was NOT saved</DialogTitle>
          <DialogDescription>
            The browser's storage for this tool is full, so your last change
            could not be saved.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-relaxed text-muted">
          {children ??
            "To make room, delete a template you no longer need, then make the change again."}
        </p>
        <DialogFooter>
          <Button onClick={onClose}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
