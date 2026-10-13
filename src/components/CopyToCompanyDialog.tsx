import { useEffect, useId, useState } from "react";
import { CopyIcon } from "lucide-react";
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
  type OtherCompany,
  copyToCompany,
  otherCompanies,
} from "@/lib/dashboardStore";
import type { Template } from "@/types/template";

type CopyToCompanyDialogProps = {
  // The template to copy; null keeps the dialog closed.
  template: Template | null;
  onClose: () => void;
};

// Copies a template, with its PDF, to another company the user is an admin
// of in the dashboard. The template here is not changed.
export function CopyToCompanyDialog({
  template,
  onClose,
}: CopyToCompanyDialogProps) {
  return (
    <Dialog
      open={template !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      {template && (
        <CopyContent key={template.id} template={template} onClose={onClose} />
      )}
    </Dialog>
  );
}

function CopyContent({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const [companies, setCompanies] = useState<OtherCompany[] | null>(null);
  const [toBrn, setToBrn] = useState("");
  const [name, setName] = useState(template.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedTo, setCopiedTo] = useState<string | null>(null);
  const companyId = useId();
  const nameId = useId();

  useEffect(() => {
    let current = true;
    void otherCompanies().then((list) => {
      if (!current) return;
      setCompanies(list);
      setToBrn(list[0]?.brn ?? "");
    });
    return () => {
      current = false;
    };
  }, []);

  async function copy() {
    if (!toBrn) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the copy a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await copyToCompany(template.id, toBrn, trimmed);
    setBusy(false);
    if (result.ok) setCopiedTo(result.company);
    else setError(`Not copied. ${result.error}`);
  }

  const nowhere = companies !== null && companies.length === 0;

  return (
    <DialogContent>
      <DialogHeader icon={<CopyIcon />}>
        <DialogTitle>Copy to another company</DialogTitle>
        <DialogDescription>
          Copies "{template.name}" and its PDF to another of your companies in
          the dashboard. Nothing changes here.
        </DialogDescription>
      </DialogHeader>

      {copiedTo !== null ? (
        <p role="status" className="text-sm text-fg">
          Copied to {copiedTo}. Select that company in the dashboard to see it.
        </p>
      ) : companies === null ? (
        <p className="text-sm text-muted">Asking the dashboard…</p>
      ) : nowhere ? (
        <p className="text-sm text-muted">
          You are not an admin of any other company in the dashboard.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={companyId} className="text-sm font-medium text-fg">
              Company
            </label>
            <select
              id={companyId}
              value={toBrn}
              onChange={(event) => setToBrn(event.target.value)}
              className="h-9 rounded-lg border border-line-strong bg-elevated px-2.5 text-sm text-fg"
            >
              {companies.map((company) => (
                <option key={company.brn} value={company.brn}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-medium text-fg">
              Name there
            </label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <DialogFooter>
        {copiedTo !== null || nowhere ? (
          <Button onClick={onClose}>OK</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => void copy()}
              disabled={busy || companies === null}
            >
              {busy ? "Copying…" : "Copy"}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
