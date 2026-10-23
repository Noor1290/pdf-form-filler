# Statement of Emoluments PDF Filler

A browser-only tool for filling repetitive PDF forms. See [CLAUDE.md](./CLAUDE.md)
for the project spec. The v1 build plan is finished and archived in
[docs/archive/roadmap.md](./docs/archive/roadmap.md); what is left for later is under "Future work" in [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md).

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

Screens never touch the browser's storage themselves. They call the operations in `src/lib/templateStore.ts`, and a store carries them out. There are two stores with the same operations: opened on its own, the tool uses the browser (`src/lib/template.ts`, `src/lib/employerProfile.ts`); inside the Payroll Hub dashboard it uses the dashboard (`src/lib/dashboardStore.ts`, below; see `docs/MIGRATION_PLAN.md` in the payroll_hub repository).

## Inside the dashboard

Opened inside the Payroll Hub dashboard, the tool keeps its templates in the dashboard's database and their PDFs in its Storage bucket, for the company selected there (`src/lib/dashboardStore.ts`; the wire contract is the hub's `docs/INTEGRATION.md`). Opened on its own it uses this browser, exactly as before.

- A change is saved by itself a moment after it is made. The bar at the top says "Saved", "Saving…" or "NOT saved", with the reason and what to do.
- The values typed into a form and the People list are never sent: they stay in this browser.
- "Copy to another company" copies a template and its PDF to another company the user is an admin of.
- "Import to the dashboard" copies this browser's templates there, once, after a backup. This browser's copy is kept as it is; on its own the tool then says "This browser only. Not the dashboard's copy."
- "History" lists a template's saved versions with the date, the time and who saved it, shows any of them drawn on its PDF, and lets an admin restore one. A restore is saved as a new revision: no earlier version is deleted or rewritten.
- When the dashboard cannot be reached, the tool offers the last copy of each company's templates this browser loaded from it (`src/lib/dashboardCache.ts`), read-only: "Offline: read-only copy from [date and time]. Changes can't be saved." Forms can still be filled in and downloaded. If the browser has no room to keep that copy, none is kept and none is offered.
- With a dashboard that does not keep templates yet, the tool uses this browser.

## Form & images

A separate tool, opened from the home screen: upload a form (a PDF, or images that each become an A4 page), draw boxes on its pages and put an image in each, add full-page images after the form's last page, and download one PDF. Nothing is stored or sent anywhere; it all happens in the browser.

**Sharpening.** An image that would print under about 300 dpi (280) can be sharpened with AI upscaling in the browser: on by default for every image (in a box or on a full page) that needs it, and can be switched off for each. The model is Real-ESRGAN's `realesr-general-x4v3` (four times larger, with its own light denoising at Real-ESRGAN's default strength, 0.5), converted to ONNX by `scripts/convert-sharpening-model.py` and run by ONNX Runtime Web (`onnxruntime-web`, MIT licence), on the graphics card where the browser allows it (WebGPU), else on the processor. The model (`public/models/realesr-general-x4v3.onnx`, 4.9 MB) and the runtime (27 MB) are downloaded once from this app's own site and kept in the browser's cache storage. A sharpened image is embedded as a lossless PNG at 300 dpi for its printed size (never more than four times the original). When the model can't run, or would take more than two minutes, the image is enlarged with high-quality resizing and gentle sharpening instead, and the screen says so.

**Scan cleaning.** Pages that are scans are cleaned as soon as the form is opened: every page made from an image, and a PDF page that is one picture covering most of the page with no visible text (an invisible searchable text layer, as scanning apps add, does not count). Real text pages are left exactly as they are. Cleaning (`src/lib/formImages/cleanScan.ts`, rule-based, run in a worker) makes the paper white area by area, and removes only small isolated specks near the edges and grey or black marks along the very edge (a scanner's shadow). Anything coloured (stamps), anything with ink near it (text, signatures) and anything reaching further into the page is kept. Each page has a before/after view and a switch; a cleaned page goes into the PDF as a lossless PNG at the scan's own resolution (at most 4,700 pixels on its long side), and a page switched off goes in exactly as scanned. Scanner watermarks such as "Scanned with CamScanner" are not removed yet: that rule is to be tuned on a real CamScanner scan.

**Saved layouts.** A layout (the boxes' pages, places, sizes and limits, and the full-page margin; never the form or the images) can be saved under a name and loaded on another form of the same kind. A form with other pages or page sizes is described plainly on loading, and boxes on pages it does not have are left out. Layouts are kept in this browser only (`pdf-editor:form-image-layouts`), inside the dashboard too; they are not in "Back up" and never sent to the dashboard.

**Model licence.** Real-ESRGAN, Copyright (c) 2021, Xintao Wang, is distributed under the BSD 3-Clause License, which allows its use in this app on condition that the copyright notice and licence are kept with it: they are in `public/models/realesr-general-x4v3.LICENSE.txt`, published next to the model. The weights are those of the v0.2.5.0 release of https://github.com/xinntao/Real-ESRGAN.

## Checks

```bash
npm test                # the safety net
npm run test:audit      # the audit
npm run test:storage    # the backup file, the store interface, the bridge's "activity" message
npm run test:dashboard  # templates kept in the dashboard: saving, copying, importing (stand-in dashboard)
npm run test:form-images  # Form & images: sizes measured in the PDF, sharpening
npm run check:text; npm run check:a11y; npm run check:preview; npm run check:build; npm run check:encoding
npm run lint; npx tsc -b
```

Do not save or commit files in this folder while a browser check is running: the test server reloads the page and the run fails with a timeout.
