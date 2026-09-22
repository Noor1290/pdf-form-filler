# Roadmap — Statement of Emoluments PDF Filler (v1)

Build in this order. Each step should leave the app in a runnable, demoable
state. Don't start a step until the previous one works.

## Step 0 — Project setup
- Vite + React + TypeScript project
- Tailwind CSS configured
- shadcn/ui installed with a couple of base components (Button, Input, Dialog)
- Basic App shell with a placeholder page

## Step 1 — Upload & render a PDF
- File input to upload a PDF
- Render it with PDF.js onto a canvas, page 1 only for now
- No editing yet — just confirm the PDF displays correctly at a reasonable
  zoom level

## Step 1.5 — Template list / home screen
- Home screen shows all saved templates (name, thumbnail or first-page
  preview optional, last updated date)
- "New Template" button starts the upload-a-PDF flow (Step 1) and leads
  into the box editor (Step 2)
- Clicking an existing template opens it into fill mode (Step 3+) or an
  "edit boxes" mode (Step 2)
- This makes multi-document support explicit from the start — the app is
  a generic "fill any repetitive PDF" tool, not a single-document tool.
  Statement of Emoluments is just the first template a user creates, not
  something hardcoded into the app.
- Delete/rename template actions here too

## Step 2 — Draw & name boxes (template editor)
- Overlay a layer on the canvas where the user can draw a rectangle
  (click-drag) to create a box
- On creating a box, prompt for a field name
- Boxes are draggable and resizable after creation (react-rnd)
- Boxes list shown in a side panel (name + quick delete)
- "Save template" button — serializes boxes + pdf filename into a Template
  object and saves to localStorage
- "Load template" — pick a saved template, re-render its boxes on the PDF

## Step 3 — Field form generation
- Given a loaded template, auto-generate one input field per box (in the
  order boxes were created, or alphabetically — decide and note it)
- Typing in a field just stores the value in state for now (no preview yet)

## Step 4 — Live preview
- Redraw each box's current input value as text onto the canvas, positioned
  at the box's stored (x, y), using the box's fontSize/fontFamily/align/bold
  settings
- Updates on every keystroke (debounce lightly if it feels laggy)
- Boxes remain visible as outlines in this view so the user can see field
  boundaries while typing

## Step 5 — Box adjustment while previewing
- Add a "lock/unlock positions" toggle (locked by default once out of
  template-editing mode, to avoid accidental drags while filling values)
- When unlocked, boxes can still be dragged/resized here, and the change
  updates the loaded template (offer a "save changes to template" action
  rather than silently mutating it)
- "Reset to template" button to discard unsaved position tweaks

## Step 6 — Export to PDF
- "Download PDF" button
- Use pdf-lib to load the original uploaded PDF and draw each field's text
  at its box position/style, matching what's shown in the preview
- Trigger a browser download of the resulting file

## Step 7 — Employer profile autofill
- Simple settings screen: company name, address, TAN, other fixed employer
  fields
- Save to localStorage as an EmployerProfile
- When a template has boxes whose names match known employer fields
  (exact or mapped match), pre-fill those inputs automatically on load,
  still editable

## Step 8 — Per-box style settings
- Click a box (in either editor or fill mode) to open a small settings
  panel: font size, font family (3 options), bold toggle, alignment,
  color
- Settings save back into the template

## Step 9 — Validation
- Zod schemas for common field types (numeric amount, NID format, etc.)
  — ask user which boxes map to which type when creating them, or infer
  from name (e.g. contains "amount" -> numeric)
- Show inline errors, don't block typing, just warn

## Step 10 — Template import/export as JSON file
- "Export template" — download the Template object as a .json file
- "Import template" — upload a .json file and load it
- This is the backup/sharing mechanism while there's no backend

## Step 11 — Deploy to GitHub Pages
- Set `base: '/<repo-name>/'` in vite.config.ts to match the GitHub repo
  name so built assets resolve correctly
- Add a GitHub Actions workflow (e.g. using actions/deploy-pages) that
  builds on every push to main and publishes to Pages
- No routing needed for v1 (single-page tool), so no extra config for
  client-side routes
- Note: the deployed site is public by default (unless on a paid GitHub
  tier with private Pages) — this is low risk since no data ever leaves
  the browser, but don't put real sample PDFs or data anywhere in the repo
- Do this early (even right after Step 2 or 3) to get a shareable link for
  showing progress, not just at the very end

## Out of scope for v1 (future, once backend/payroll project exists)
- Batch CSV import for multiple employees at once
- Shared templates across users via a real backend
- Audit log of generated PDFs
- Custom font embedding to match MRA's exact font
- Multi-page box support beyond what's structurally already allowed in the
  data model (page field exists, but v1 UI can stay single-page-focused if
  the real form is one page)

## Notes
- Get 2–3 real (but blank) sample PDFs and a couple of hand-filled examples
  from the mentor early, to test against real layouts, not assumptions.
- Keep an eye on Claude Code usage — do one step per session where
  possible, and start a fresh session per step so context stays small.
