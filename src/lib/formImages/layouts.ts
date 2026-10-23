// Saved layouts of the "Form & images" tool: the boxes (page, place,
// size, size limit) and the full-page margin, under a name, for forms of
// the same kind. Never the form or the images.
//
// Kept in this browser only, under a key of their own: not a template, so
// not in "Back up" (lib/backup.ts lists its keys) and never sent to the
// dashboard, inside it or not.
import { z } from "zod";
import { formatCm, keepBoxInBounds, pageMm } from "@/lib/formImages/measure";
import type { FormPage, ImageBox } from "@/types/formImages";

export const LAYOUTS_STORAGE_KEY = "pdf-editor:form-image-layouts";

const layoutSchema = z.object({
  name: z.string().min(1),
  savedAt: z.string(),
  // Each page of the form it was saved for, in whole millimetres.
  pages: z.array(z.object({ widthMm: z.number(), heightMm: z.number() })),
  boxes: z.array(
    z.object({
      page: z.number().int().min(1),
      xMm: z.number(),
      yMm: z.number(),
      widthMm: z.number(),
      heightMm: z.number(),
      limitWidthMm: z.number(),
      limitHeightMm: z.number(),
    }),
  ),
  marginMm: z.number(),
});

export type SavedLayout = z.infer<typeof layoutSchema>;

// The saved layouts, by name. Anything stored that is not a layout is
// passed over, never shown half-read.
export function listLayouts(): SavedLayout[] {
  let stored: unknown;
  try {
    stored = JSON.parse(localStorage.getItem(LAYOUTS_STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];
  return stored
    .map((item) => layoutSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result) => result.data)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// False when the browser refused to store it (its storage is full).
function store(layouts: SavedLayout[]): boolean {
  try {
    localStorage.setItem(LAYOUTS_STORAGE_KEY, JSON.stringify(layouts));
    return true;
  } catch {
    return false;
  }
}

// A layout of these boxes and margin, for this form's pages.
export function layoutOf(
  name: string,
  pages: FormPage[],
  boxes: ImageBox[],
  marginMm: number,
): SavedLayout {
  return {
    name,
    savedAt: new Date().toISOString(),
    pages: pages.map((page) => {
      const size = pageMm(page);
      return { widthMm: size.width, heightMm: size.height };
    }),
    boxes: boxes.map(({ page, xMm, yMm, widthMm, heightMm, limitWidthMm, limitHeightMm }) => ({
      page,
      xMm,
      yMm,
      widthMm,
      heightMm,
      limitWidthMm,
      limitHeightMm,
    })),
    marginMm,
  };
}

// Saved in place of any layout of the same name.
export function saveLayout(layout: SavedLayout): boolean {
  return store([...listLayouts().filter((other) => other.name !== layout.name), layout]);
}

export function deleteLayout(name: string): boolean {
  return store(listLayouts().filter((layout) => layout.name !== name));
}

// "2 pages of 21.0 × 29.7 cm", "1 page of 21.6 × 27.9 cm", or each size.
function describePages(pages: { widthMm: number; heightMm: number }[]): string {
  const sizes = [...new Set(pages.map((page) => `${formatCm(page.widthMm)} × ${formatCm(page.heightMm)} cm`))];
  const count = `${pages.length} ${pages.length === 1 ? "page" : "pages"}`;
  return `${count} of ${sizes.join(", ")}`;
}

// The layout's boxes on this form: a box on a page the form doesn't have
// is left out, and every other box is kept on its page and within its
// limit. When the form is not like the one the layout was saved for, says
// so, plainly, for the person to check the boxes.
export function boxesForForm(
  layout: SavedLayout,
  pages: FormPage[],
  label: (index: number) => string,
): { boxes: ImageBox[]; mismatch: string | null } {
  const sizes = pages.map((page) => {
    const size = pageMm(page);
    return { widthMm: size.width, heightMm: size.height };
  });
  const sameForm =
    sizes.length === layout.pages.length &&
    sizes.every(
      (size, index) =>
        Math.abs(size.widthMm - layout.pages[index].widthMm) <= 1 &&
        Math.abs(size.heightMm - layout.pages[index].heightMm) <= 1,
    );

  const boxes: ImageBox[] = [];
  const leftOut: number[] = [];
  for (const saved of layout.boxes) {
    if (saved.page > pages.length) {
      leftOut.push(saved.page);
      continue;
    }
    boxes.push(
      keepBoxInBounds(
        { ...saved, id: crypto.randomUUID(), label: label(boxes.length), image: null },
        pageMm(pages[saved.page - 1]),
      ),
    );
  }

  if (sameForm) return { boxes, mismatch: null };
  const missing = [...new Set(leftOut)];
  const left =
    missing.length > 0
      ? ` Its boxes on ${missing.length === 1 ? "page" : "pages"} ${missing.join(", ")} were left out.`
      : "";
  return {
    boxes,
    mismatch:
      `"${layout.name}" was saved for a form of ${describePages(layout.pages)}; ` +
      `this form has ${describePages(sizes)}.${left} Check the boxes, and move or resize them where needed.`,
  };
}
