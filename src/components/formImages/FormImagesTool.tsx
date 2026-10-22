import { useEffect, useRef, useState } from "react";
import {
  CircleAlertIcon,
  DownloadIcon,
  FileUpIcon,
  ImageIcon,
  LogOutIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { BoxSettings } from "@/components/formImages/BoxSettings";
import {
  FormPageView,
  type LiveBox,
} from "@/components/formImages/FormPageView";
import {
  FullPageImagesPanel,
  FullPagePreview,
} from "@/components/formImages/FullPageImages";
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
import { buildCompletedPdf } from "@/lib/formImages/buildPdf";
import { FormFileError, openForm, type OpenedForm } from "@/lib/formImages/formFiles";
import { forgetImage, loadImageFile } from "@/lib/formImages/imageFiles";
import {
  A4_PORTRAIT_MM,
  DEFAULT_LIMIT_MM,
  DEFAULT_MARGIN_MM,
  completedFileName,
  formatSizeCm,
  keepBoxInBounds,
  overLimit,
  pageMm,
  pixelsPerMmFor,
} from "@/lib/formImages/measure";
import { downloadPdfBytes } from "@/lib/pdf";
import { useReportUnsaved } from "@/lib/unsavedChanges";
import type { ImageBox, LoadedImage } from "@/types/formImages";

type FormImagesToolProps = {
  onBack: () => void;
};

const NOT_AN_IMAGE = (name: string) =>
  `"${name}" isn't an image this tool can use (JPG or PNG).`;
const AT_LIMIT = (widthMm: number, heightMm: number) =>
  `A box can't be larger than its size limit, ${formatSizeCm(widthMm, heightMm)}. You can change a box's limit under "Size limit".`;

// The "Form & images" tool: a form (PDF or images), boxes on its pages
// each holding an image, full-page images after it, and one PDF to
// download. Nothing is saved or sent anywhere; it is all in this page's
// memory, so leaving asks first.
export default function FormImagesTool({ onBack }: FormImagesToolProps) {
  const formInputRef = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState<OpenedForm | null>(null);
  const [boxes, setBoxes] = useState<ImageBox[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullPageImages, setFullPageImages] = useState<LoadedImage[]>([]);
  const [marginMm, setMarginMm] = useState(DEFAULT_MARGIN_MM);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [leaving, setLeaving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  // What a delete or remove dialog was opened for. Kept after it closes, so
  // the dialog still names it while it fades out (as known issue 7).
  const [deletingBox, setDeletingBox] = useState<ImageBox | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [removingImage, setRemovingImage] = useState<LoadedImage | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const boxCount = useRef(0);
  // Counts sizes and limits set by typing, so the box settings show the
  // box's real values again afterwards, even when it did not change (a
  // size typed past the limit).
  const [sizesTyped, setSizesTyped] = useState(0);

  // Every image chosen while the screen is open, so their previews can be
  // let go of when it closes.
  const allImages = useRef(new Set<LoadedImage>());
  useEffect(() => {
    const images = allImages.current;
    return () => {
      for (const image of images) forgetImage(image);
    };
  }, []);
  function keep(image: LoadedImage): LoadedImage {
    allImages.current.add(image);
    return image;
  }
  function letGo(image: LoadedImage | null | undefined) {
    if (!image) return;
    allImages.current.delete(image);
    forgetImage(image);
  }

  const form = opened?.form ?? null;
  const holdsSomething = form !== null || fullPageImages.length > 0;

  // Inside the dashboard, it asks before reloading the tool; on its own,
  // the browser asks before the page is closed or reloaded.
  useReportUnsaved("form-images", holdsSomething);
  useEffect(() => {
    if (!holdsSomething) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [holdsSomething]);

  function leave() {
    if (holdsSomething) setLeaving(true);
    else onBack();
  }

  // ---------------------------------------------------------------- form

  async function handleFormFiles(files: File[]) {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const next = await openForm(files);
      for (const page of next.form.pages) if (page.image) keep(page.image);
      for (const page of form?.pages ?? []) letGo(page.image);
      if (form === null) setFileName(completedFileName(next.form.fileName));
      else if (fileName === completedFileName(form.fileName)) {
        setFileName(completedFileName(next.form.fileName));
      }
      setOpened(next);
      fitBoxesToForm(next);
    } catch (problem) {
      setError(
        problem instanceof FormFileError
          ? problem.message
          : "This file couldn't be opened. Please try another one.",
      );
    } finally {
      setLoading(false);
    }
  }

  // After another form is chosen: boxes stay on the same pages, kept on
  // the page, and a box on a page the new form doesn't have is removed.
  function fitBoxesToForm(next: OpenedForm) {
    const removed = boxes.filter((box) => box.page > next.form.pages.length);
    for (const box of removed) letGo(box.image);
    setBoxes(
      boxes
        .filter((box) => box.page <= next.form.pages.length)
        .map((box) => keepBoxInBounds(box, pageMm(next.form.pages[box.page - 1]))),
    );
    if (removed.length > 0) {
      setNotice(
        `Removed because the new form has no such page: ${removed.map((box) => box.label).join(", ")}.`,
      );
    }
  }

  // ---------------------------------------------------------------- boxes

  function pageSizeOf(box: ImageBox) {
    return pageMm(form!.pages[box.page - 1]);
  }

  function updateBox(id: string, change: (box: ImageBox) => ImageBox) {
    setBoxes((current) => current.map((box) => (box.id === id ? change(box) : box)));
  }

  function drawBox(pageNumber: number, rect: LiveBox) {
    setNotice(null);
    boxCount.current += 1;
    const box: ImageBox = {
      id: crypto.randomUUID(),
      label: `Box ${boxCount.current}`,
      page: pageNumber,
      ...rect,
      limitWidthMm: DEFAULT_LIMIT_MM,
      limitHeightMm: DEFAULT_LIMIT_MM,
      image: null,
    };
    setBoxes((current) => [...current, box]);
    setSelectedId(box.id);
  }

  function moveBox(id: string, rect: LiveBox) {
    updateBox(id, (box) => keepBoxInBounds({ ...box, ...rect }, pageSizeOf(box)));
  }

  // A typed size: kept within the box's limit and on its page, saying so.
  function setBoxSize(box: ImageBox, widthMm: number, heightMm: number) {
    setSizesTyped((count) => count + 1);
    const fitted = keepBoxInBounds({ ...box, widthMm, heightMm }, pageSizeOf(box));
    if (overLimit(box, widthMm, heightMm)) {
      setNotice(AT_LIMIT(box.limitWidthMm, box.limitHeightMm));
    } else if (fitted.widthMm !== widthMm || fitted.heightMm !== heightMm) {
      setNotice(
        `${box.label} is now ${formatSizeCm(fitted.widthMm, fitted.heightMm)}: a box must fit on its page and be at least 0.5 cm wide and high.`,
      );
    } else {
      setNotice(null);
    }
    updateBox(box.id, () => fitted);
  }

  // A new limit; a box larger than it is made smaller (top-left kept).
  function setBoxLimit(box: ImageBox, limitWidthMm: number, limitHeightMm: number) {
    setSizesTyped((count) => count + 1);
    const fitted = keepBoxInBounds(
      { ...box, limitWidthMm, limitHeightMm },
      pageSizeOf(box),
    );
    const shrunk =
      fitted.widthMm !== box.widthMm || fitted.heightMm !== box.heightMm;
    setNotice(
      shrunk
        ? `${box.label} was made smaller to fit its new size limit: it is now ${formatSizeCm(fitted.widthMm, fitted.heightMm)}.`
        : null,
    );
    updateBox(box.id, () => fitted);
  }

  async function chooseBoxImage(box: ImageBox, file: File) {
    setError(null);
    try {
      const image = keep(await loadImageFile(file));
      letGo(box.image);
      updateBox(box.id, (current) => ({ ...current, image }));
    } catch {
      setError(NOT_AN_IMAGE(file.name));
    }
  }

  function confirmDeleteBox() {
    if (!deletingBox) return;
    letGo(deletingBox.image);
    setBoxes((current) => current.filter((box) => box.id !== deletingBox.id));
    if (selectedId === deletingBox.id) setSelectedId(null);
    setDeleteOpen(false);
  }

  // ------------------------------------------------------ full-page images

  async function addFullPageImages(files: File[]) {
    setError(null);
    const added: LoadedImage[] = [];
    const refused: string[] = [];
    for (const file of files) {
      try {
        added.push(keep(await loadImageFile(file)));
      } catch {
        refused.push(file.name);
      }
    }
    setFullPageImages((current) => [...current, ...added]);
    if (refused.length > 0) setError(refused.map(NOT_AN_IMAGE).join(" "));
  }

  function moveFullPageImage(index: number, by: -1 | 1) {
    setFullPageImages((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  }

  function confirmRemoveImage() {
    if (!removingImage) return;
    letGo(removingImage);
    setFullPageImages((current) => current.filter((image) => image !== removingImage));
    setRemoveOpen(false);
  }

  // -------------------------------------------------------------- download

  async function download() {
    if (!form) return;
    setError(null);
    setDownloading(true);
    try {
      const bytes = await buildCompletedPdf({ form, boxes, fullPageImages, marginMm });
      const name = fileName.trim() || completedFileName(form.fileName);
      downloadPdfBytes(bytes, /\.pdf$/i.test(name) ? name : `${name}.pdf`);
    } catch {
      setError("Something went wrong creating your PDF.");
    } finally {
      setDownloading(false);
    }
  }

  const selected = boxes.find((box) => box.id === selectedId) ?? null;
  const formPageCount = form?.pages.length ?? 0;
  const pageCount = formPageCount + fullPageImages.length;
  const boxesWithoutImage = boxes.filter((box) => !box.image);

  return (
    <div className="flex w-full max-w-296 flex-col gap-5">
      <div className="flex w-full animate-rise flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-2xl font-semibold tracking-tight text-fg">
            Form & images
          </h2>
          <p className="text-sm text-muted">
            Put images in boxes on a form, add full-page images at the end, and
            download one PDF. Nothing is saved or sent anywhere: it all stays
            on this computer.
          </p>
        </div>
        <Button variant="outline" onClick={leave}>
          Back to templates
        </Button>
      </div>

      {error && (
        <p role="alert" className="notice-panel notice-danger">
          <CircleAlertIcon />
          {error}
        </p>
      )}

      <input
        ref={formInputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        multiple
        className="hidden"
        data-testid="form-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) void handleFormFiles(files);
        }}
      />

      {!form ? (
        <div className="glass flex w-full animate-rise flex-col items-center gap-4 px-6 py-14 text-center">
          <div className="icon-tile">
            <FileUpIcon className="size-5" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-fg">Upload the form</p>
            <p className="text-sm text-muted">
              A PDF with one or more pages, or one or more images (JPG or PNG).
              Each image becomes one A4 page.
            </p>
          </div>
          <Button
            className="mt-1"
            disabled={loading}
            onClick={() => formInputRef.current?.click()}
          >
            <UploadIcon />
            {loading ? "Opening…" : "Choose the form"}
          </Button>
        </div>
      ) : (
        <div className="flex w-full flex-col items-start gap-5 xl:flex-row xl:justify-between">
          <div className="preview-frame flex max-w-full flex-col gap-6 overflow-x-auto p-4">
            {form.pages.map((page) => (
              <FormPageView
                key={`${page.number}-${form.fileName}`}
                page={page}
                pageCount={pageCount}
                pdf={opened?.pdf ?? null}
                boxes={boxes.filter((box) => box.page === page.number)}
                selectedBoxId={selectedId}
                onSelectBox={setSelectedId}
                onDrawBox={(rect) => drawBox(page.number, rect)}
                onMoveBox={moveBox}
                onAtLimit={(width, height) => setNotice(AT_LIMIT(width, height))}
              />
            ))}
            {fullPageImages.map((image, index) => (
              <FullPagePreview
                key={image.id}
                image={image}
                pageNumber={formPageCount + index + 1}
                pageCount={pageCount}
                marginMm={marginMm}
                pixelsPerMm={pixelsPerMmFor(A4_PORTRAIT_MM.width)}
              />
            ))}
          </div>

          <div className="flex w-full min-w-0 shrink-0 animate-rise flex-col gap-4 xl:sticky xl:top-4 xl:w-96">
            {/* Here, not above the pages: a message that appears while a
                box is being drawn must not move the page under the pointer. */}
            {notice && (
              <p role="status" className="notice-panel notice-warn">
                <CircleAlertIcon />
                {notice}
              </p>
            )}
            <section className="glass flex flex-col">
              <div className="card-header">
                <h3 className="card-title">Form</h3>
              </div>
              <div className="flex items-center gap-3 p-4">
                <span className="min-w-0 flex-1 text-sm break-words text-fg">
                  {form.fileName} ({form.pages.length}{" "}
                  {form.pages.length === 1 ? "page" : "pages"})
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loading}
                  onClick={() =>
                    boxes.length > 0 ? setReplacing(true) : formInputRef.current?.click()
                  }
                >
                  Use another form
                </Button>
              </div>
            </section>

            <section className="glass flex flex-col">
              <div className="card-header">
                <h3 className="card-title">Boxes</h3>
              </div>
              {boxes.length === 0 ? (
                <p className="p-4 text-sm text-muted">
                  No boxes yet. Drag on a page to draw one, then choose its
                  image.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 p-4">
                  {boxes.map((box) => (
                    <li key={box.id}>
                      <Button
                        variant={box.id === selectedId ? "default" : "outline"}
                        size="sm"
                        className="w-full justify-start"
                        aria-pressed={box.id === selectedId}
                        onClick={() => setSelectedId(box.id)}
                      >
                        {box.image ? <ImageIcon /> : null}
                        {box.label}, page {box.page}, {formatSizeCm(box.widthMm, box.heightMm)}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {selected && (
              <BoxSettings
                key={`${selected.id}-${selected.widthMm}-${selected.heightMm}-${selected.limitWidthMm}-${selected.limitHeightMm}-${sizesTyped}`}
                box={selected}
                onChooseImage={(file) => void chooseBoxImage(selected, file)}
                onSetSize={(width, height) => setBoxSize(selected, width, height)}
                onSetLimit={(width, height) => setBoxLimit(selected, width, height)}
                onDelete={() => {
                  setDeletingBox(selected);
                  setDeleteOpen(true);
                }}
                onNotASize={() => {
                  setSizesTyped((count) => count + 1);
                  setNotice("Type a size in cm, for example 7.8.");
                }}
              />
            )}

            <FullPageImagesPanel
              images={fullPageImages}
              firstPageNumber={formPageCount + 1}
              marginMm={marginMm}
              onAdd={(files) => void addFullPageImages(files)}
              onMove={moveFullPageImage}
              onRemove={(image) => {
                setRemovingImage(image);
                setRemoveOpen(true);
              }}
              onMargin={setMarginMm}
              onNotAMargin={() =>
                setNotice("Type the margin in whole millimetres, from 0 to 50.")
              }
            />

            <section className="glass flex flex-col">
              <div className="card-header">
                <h3 className="card-title">Download</h3>
              </div>
              <div className="flex flex-col gap-3 p-4">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-fg">
                  File name
                  <Input
                    value={fileName}
                    onChange={(event) => setFileName(event.target.value)}
                  />
                </label>
                {boxesWithoutImage.length > 0 && (
                  <p className="text-sm text-muted">
                    No image yet, so not in the PDF:{" "}
                    {boxesWithoutImage.map((box) => box.label).join(", ")}.
                  </p>
                )}
                <Button onClick={() => void download()} disabled={downloading}>
                  <DownloadIcon />
                  {downloading ? "Preparing PDF…" : "Download PDF"}
                </Button>
              </div>
            </section>
          </div>
        </div>
      )}

      <Dialog open={leaving} onOpenChange={(open) => !open && setLeaving(false)}>
        <DialogContent>
          <DialogHeader icon={<LogOutIcon />} tone="danger">
            <DialogTitle>Leave?</DialogTitle>
            <DialogDescription>
              The form and images you added will be cleared.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaving(false)}>
              Stay
            </Button>
            <Button variant="destructive" onClick={onBack}>
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replacing} onOpenChange={(open) => !open && setReplacing(false)}>
        <DialogContent>
          <DialogHeader icon={<FileUpIcon />}>
            <DialogTitle>Use another form?</DialogTitle>
            <DialogDescription>
              Your boxes stay on the same pages. A box on a page the new form
              doesn't have is removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplacing(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setReplacing(false);
                formInputRef.current?.click();
              }}
            >
              Choose another form
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader icon={<Trash2Icon />} tone="danger">
            <DialogTitle>Delete {deletingBox?.label}?</DialogTitle>
            <DialogDescription>
              The box and its image will be removed from the form. You'll need
              to draw it again if you change your mind.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteBox}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader icon={<Trash2Icon />} tone="danger">
            <DialogTitle>Remove this image?</DialogTitle>
            <DialogDescription>
              "{removingImage?.name}" and its page will be removed from the
              PDF.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRemoveImage}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
