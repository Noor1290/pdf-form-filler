# CLAUDE.md — Statement of Emoluments PDF Filler

## What this project is
A browser-only tool that lets a user upload a blank PDF (e.g. MRA Statement of
Emoluments), draw named text-box fields on top of it, then fill those fields
via a form with a live preview, and export a filled PDF. No backend in v1.

## Stack
- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui components
- PDF.js — render the PDF onto a canvas
- pdf-lib — bake final text into a downloadable PDF (client-side)
- react-rnd (or interact.js) — draggable/resizable box editor
- Zustand or plain React state — no Redux needed
- Zod — input validation
- Storage: localStorage only in v1 (see docs/roadmap.md). Support
  export/import of templates as .json files for backup and sharing between
  users, since localStorage is per-browser/per-device.

## Audience: non-technical users
The primary users (an accountant and his daughter, not developers) will use
this daily. Every screen must be understandable without instructions:
- Plain language labels, no jargon ("Add a field" not "Add FieldBox
  entity"). No developer terms visible anywhere in the UI.
- Every action has a clear, visible button — no keyboard shortcuts as the
  only way to do something, no hidden right-click menus.
- Destructive actions (delete template, delete box) always ask for
  confirmation with a plain description of what will be lost.
- Empty states explain what to do next (e.g. "No templates yet — upload a
  PDF to create your first one" with a button right there), not a blank
  screen.
- Errors are worded for a non-developer: "This file doesn't look like a
  PDF" not a stack trace or technical error message.
- Drag/resize handles on boxes must be obviously clickable (visible
  handles, cursor changes on hover) — don't rely on the user discovering
  hidden interactions.
- Keep the fill-in screen (the one used most often, day to day) as simple
  as possible: it should basically just look like a form next to the PDF
  preview, nothing else competing for attention.
- Test every step by asking: "could my mentor's daughter do this without
  me explaining it?" If not, simplify before moving on.

## Hard rules
- Never hardcode statement layout assumptions — everything about a field
  (position, size, page, font, alignment) comes from the saved template
  JSON, not from constants in code.
- Money/amount fields are stored and rendered as strings the user typed
  unless we explicitly add parsing — do not silently reformat or round
  values.
- Do not invent MRA field names or form structure. If unsure what a field
  is called, ask, don't guess.
- Don't touch files outside the current task/step.
- Don't rewrite or "fix" tests to make them pass — fix the underlying code.
- Keep components small and typed. No `any` in TypeScript unless justified
  with a comment.
- All text drawn on the PDF preview canvas and the exported PDF must use
  pdf-lib's standard fonts (Helvetica, Times-Roman, Courier + bold/italic
  variants) in v1. Do not attempt custom font embedding unless asked.
- Never commit real employee data (names, salaries, NID numbers) to the
  repo, even as test fixtures. Use obviously fake sample data only.

## Code style & readability
- Code should read top-to-bottom like a story: file and function names
  describe what they do, related logic stays grouped together, and a
  reader should be able to follow the flow (e.g. App → which component →
  which lib function) without jumping around unnecessarily.
- Prefer small, single-purpose functions and files over large ones that do
  many unrelated things. If a file starts doing more than one clear job,
  split it.
- Add a short comment above any non-obvious piece of logic explaining
  *why* it's done that way, not just *what* it does — the *what* should
  already be clear from the code itself.
- Keep naming consistent across the whole codebase (e.g. a "box" is always
  called a box in code, UI copy, and types — never sometimes "field" or
  "region" instead).
- Avoid deeply nested conditionals/callbacks; prefer early returns and
  extracting helper functions to keep each function shallow and readable.
- When a step touches a file, leave it a little easier to read than you
  found it — but don't do unrelated refactors outside the current step.

## Folder structure (target)
```
/src
  /components   (TemplateList, Toolbar, BoxEditor, PdfCanvas, FieldForm,
                 SettingsPanel...)
  /lib          (pdf.ts — PDF.js + pdf-lib helpers, template.ts — template
                 CRUD against localStorage, validation.ts — Zod schemas)
  /store        (template store, field-values store)
  /types        (Template, FieldBox, EmployerProfile types)
App.tsx
main.tsx
```

## Data model
```ts
type FieldBox = {
  id: string;
  name: string;
  page: number;
  x: number; y: number; width: number; height: number;
  fontSize: number;
  fontFamily: "Helvetica" | "Times-Roman" | "Courier";
  bold: boolean;
  align: "left" | "center" | "right";
  color: string; // hex
};

type Template = {
  id: string;
  name: string;          // e.g. "Statement of Emoluments 2026"
  pdfFileName: string;
  boxes: FieldBox[];
  createdAt: string;
  updatedAt: string;
};

type EmployerProfile = {
  companyName: string;
  address: string;
  tan: string;
  // ...other fixed employer fields
};
```

## Working style
- Build in the step order given in docs/roadmap.md. Don't jump ahead.
- After each step, the app should still run and be demoable.
- Ask for clarification rather than guessing on anything related to MRA
  form fields or layout.
