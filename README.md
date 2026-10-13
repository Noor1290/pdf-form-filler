# Statement of Emoluments PDF Filler

A browser-only tool for filling repetitive PDF forms. See [CLAUDE.md](./CLAUDE.md)
for the project spec and [roadmap.md](./roadmap.md) for the build plan.

## Development

```bash
npm install
npm run dev
```

## Backup

Everything the tool holds is in this browser only. On the template list:

- **Back up** saves one file, `pdf-form-filler-backup-YYYY-MM-DD.json`, with every template exactly as stored: its PDF, fields, company details, the values last typed and the People list. The light/dark choice is not in it.
- **Restore** puts such a file back. It first shows what is in the file and what is in the browser now, and replaces nothing until "Replace with this backup" is chosen. Restoring replaces every template in this browser; it is all or nothing, so a restore the browser refuses (storage full) leaves what was there.

A backup file holds whatever was typed into the forms, people's details included: keep it where those are kept, and never in this repository.

## Where the data is read and saved

Screens never touch the browser's storage themselves. They call the operations in `src/lib/templateStore.ts`, and a store carries them out. Today the only store is the browser (`src/lib/template.ts`, `src/lib/employerProfile.ts`), so the tool behaves as it always has. Saving through the Payroll Hub dashboard (see `docs/MIGRATION_PLAN.md` in the payroll_hub repository) will be a second store with the same operations.

## Inside the dashboard

Opened inside the Payroll Hub dashboard, the tool keeps its templates in the dashboard's database and their PDFs in its Storage bucket, for the company selected there (`src/lib/dashboardStore.ts`; the wire contract is the hub's `docs/INTEGRATION.md`). Opened on its own it uses this browser, exactly as before.

- A change is saved by itself a moment after it is made. The bar at the top says "Saved", "Saving…" or "NOT saved", with the reason and what to do.
- The values typed into a form and the People list are never sent: they stay in this browser.
- "Copy to another company" copies a template and its PDF to another company the user is an admin of.
- "Import to the dashboard" copies this browser's templates there, once, after a backup. This browser's copy is kept as it is; on its own the tool then says "This browser only. Not the dashboard's copy."
- "History" lists a template's saved versions with the date, the time and who saved it, shows any of them drawn on its PDF, and lets an admin restore one. A restore is saved as a new revision: no earlier version is deleted or rewritten.
- When the dashboard cannot be reached, the tool offers the last copy of each company's templates this browser loaded from it (`src/lib/dashboardCache.ts`), read-only: "Offline: read-only copy from [date and time]. Changes can't be saved." Forms can still be filled in and downloaded. If the browser has no room to keep that copy, none is kept and none is offered.
- With a dashboard that does not keep templates yet, the tool uses this browser.

## Checks

```bash
npm test                # the safety net
npm run test:audit      # the audit
npm run test:storage    # the backup file, the store interface, the bridge's "activity" message
npm run test:dashboard  # templates kept in the dashboard: saving, copying, importing (stand-in dashboard)
npm run check:text; npm run check:a11y; npm run check:preview; npm run check:build; npm run check:encoding
npm run lint; npx tsc -b
```

Do not save or commit files in this folder while a browser check is running: the test server reloads the page and the run fails with a timeout.
