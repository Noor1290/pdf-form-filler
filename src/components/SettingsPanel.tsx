import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getEmployerProfile, saveEmployerProfile } from "@/lib/employerProfile";
import type { EmployerProfile } from "@/types/template";

type SettingsPanelProps = {
  onBack: () => void;
};

export function SettingsPanel({ onBack }: SettingsPanelProps) {
  const [profile, setProfile] = useState<EmployerProfile>(() =>
    getEmployerProfile(),
  );
  const [saved, setSaved] = useState(false);

  function update(field: keyof EmployerProfile, value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  function handleSave() {
    saveEmployerProfile(profile);
    setSaved(true);
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Employer details</h2>
        <Button variant="outline" onClick={onBack}>
          Back to templates
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Save these once and matching fields (like company name or TAN) will
        fill in automatically whenever you open a template — still editable
        every time.
      </p>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="employer-company-name"
          className="text-sm font-medium"
        >
          Company name
        </label>
        <Input
          id="employer-company-name"
          value={profile.companyName}
          onChange={(event) => update("companyName", event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="employer-address" className="text-sm font-medium">
          Address
        </label>
        <Input
          id="employer-address"
          value={profile.address}
          onChange={(event) => update("address", event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="employer-tan" className="text-sm font-medium">
          TAN
        </label>
        <Input
          id="employer-tan"
          value={profile.tan}
          onChange={(event) => update("tan", event.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleSave}>Save</Button>
        {saved && (
          <span className="text-sm text-muted-foreground">Saved</span>
        )}
      </div>
    </div>
  );
}
