import { useEffect, useRef, useState } from "react";
import type { PdfDocument } from "@/lib/pdf";
import {
  cleanFormPage,
  forgetCleanedPage,
  type CleanedPage,
} from "@/lib/formImages/scanPages";
import type { FormPage, LoadedForm } from "@/types/formImages";

export type PageCleaning =
  | { status: "working" }
  | { status: "done"; cleaned: CleanedPage }
  | { status: "failed" };

type ForForm = {
  form: LoadedForm | null;
  pages: Record<number, PageCleaning>;
  // Pages switched off; cleaning is on for every scan until then.
  off: Record<number, boolean>;
};

// Cleans the form's scanned pages as soon as the form is opened, one page
// at a time, and keeps which are switched off. Another form starts again.
export function useScanCleaning(form: LoadedForm | null, pdf: PdfDocument | null) {
  const [byForm, setByForm] = useState<ForForm>({ form: null, pages: {}, off: {} });
  const current: ForForm = byForm.form === form ? byForm : { form, pages: {}, off: {} };

  // Every cleaned page kept, so its previews can be let go of.
  const kept = useRef(new Map<CleanedPage, FormPage>());
  const formNow = useRef(form);
  useEffect(() => {
    formNow.current = form;
    const keptForThisForm = kept.current;
    return () => {
      // The form is replaced or the screen closed: its pages' previews go.
      for (const [cleaned, page] of keptForThisForm) forgetCleanedPage(page, cleaned);
      keptForThisForm.clear();
    };
  }, [form]);

  function update(forForm: LoadedForm | null, change: (state: ForForm) => ForForm) {
    setByForm((previous) =>
      change(previous.form === forForm ? previous : { form: forForm, pages: {}, off: {} }),
    );
  }

  const working = Object.values(current.pages).some((state) => state.status === "working");
  const next = working
    ? undefined
    : form?.pages.find((page) => page.scan && !current.pages[page.number]);
  useEffect(() => {
    if (!next || !form) return;
    const setPage = (state: PageCleaning) =>
      update(form, (previous) => ({
        ...previous,
        pages: { ...previous.pages, [next.number]: state },
      }));
    setPage({ status: "working" });
    cleanFormPage(next, pdf).then(
      (cleaned) => {
        // Another form was chosen meanwhile: this page is not needed.
        if (formNow.current !== form) {
          forgetCleanedPage(next, cleaned);
          return;
        }
        kept.current.set(cleaned, next);
        setPage({ status: "done", cleaned });
      },
      () => setPage({ status: "failed" }),
    );
    // `update` and `pdf` follow `form`; the work starts once per page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next]);

  const isOn = (page: FormPage) => !current.off[page.number];

  return {
    stateOf: (page: FormPage) => current.pages[page.number],
    isOn,
    switchPage: (page: FormPage, on: boolean) =>
      update(form, (previous) => ({ ...previous, off: { ...previous.off, [page.number]: !on } })),
    // The cleaned picture to show for a page, when it is cleaned and on.
    cleanedUrl: (page: FormPage) => {
      const state = current.pages[page.number];
      return state?.status === "done" && isOn(page) ? state.cleaned.afterUrl : null;
    },
    // The PDF waits while a page it would use is being cleaned.
    busy: (form?.pages ?? []).some((page) => {
      const state = current.pages[page.number];
      return page.scan && isOn(page) && (!state || state.status === "working");
    }),
    // Each cleaned page that is switched on, as a PNG, by page number.
    cleanedForPdf: (): Map<number, Uint8Array> => {
      const ready = new Map<number, Uint8Array>();
      for (const [number, state] of Object.entries(current.pages)) {
        if (state.status === "done" && !current.off[Number(number)]) {
          ready.set(Number(number), state.cleaned.png);
        }
      }
      return ready;
    },
  };
}
