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

## Checks

```bash
npm test                # the safety net
npm run test:audit      # the audit
npm run test:storage    # the backup file, the store interface, the bridge's "activity" message
npm run check:text; npm run check:a11y; npm run check:preview; npm run check:build; npm run check:encoding
npm run lint; npx tsc -b
```

Do not save or commit files in this folder while a browser check is running: the test server reloads the page and the run fails with a timeout.
