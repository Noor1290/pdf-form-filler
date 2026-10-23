import { useEffect, useRef, useState } from "react";
import type { ImageUse, SharpenState } from "@/components/formImages/Sharpening";
import { needsSharpening } from "@/lib/formImages/resolution";
import { enlarge, sharpenedPng, type SharpenedImage } from "@/lib/formImages/sharpen";
import type { LoadedImage } from "@/types/formImages";

export type ImageUseInput = {
  image: LoadedImage;
  printedWidthMm: number;
};

// Sharpening for every image in use: which are switched off (all are on
// until switched off), and the model's work on each, one image at a time,
// started as soon as an image is placed where it would print under about
// 300 dpi.
export function useSharpening(inputs: ImageUseInput[]) {
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [states, setStates] = useState<Record<string, SharpenState>>({});

  const uses = new Map<string, ImageUse>(
    inputs.map(({ image, printedWidthMm }) => [
      image.id,
      { image, printedWidthMm, on: choices[image.id] ?? true },
    ]),
  );
  const wanted = [...uses.values()].filter(
    (use) => use.on && needsSharpening(use.image.pixelWidth, use.printedWidthMm),
  );

  // Images still in use and switched on, for the work in progress to ask
  // whether to stop.
  const stillWanted = useRef(new Set<string>());
  const wantedNow = wanted.map((use) => use.image.id).join();
  useEffect(() => {
    stillWanted.current = new Set(wantedNow.split(","));
  }, [wantedNow]);

  // One image at a time: the next one starts when none is being worked on.
  const working = Object.values(states).some((state) => state.status === "working");
  const next = working ? undefined : wanted.find((use) => !states[use.image.id]);
  useEffect(() => {
    if (!next) return;
    const { image } = next;
    const update = (state: SharpenState | null) =>
      setStates((current) => {
        const { [image.id]: _old, ...rest } = current;
        return state ? { ...rest, [image.id]: state } : rest;
      });
    update({ status: "working", progress: 0 });
    enlarge(
      image,
      (progress) => update({ status: "working", progress }),
      () => !stillWanted.current.has(image.id),
    ).then(
      (result) => update({ status: "done", result }),
      // Stopped because the image was removed or switched off: nothing is
      // kept, and switched on again it starts again.
      () => update(null),
    );
  }, [next]);

  // The PDF waits for every image being sharpened.
  const busy = wanted.some((use) => states[use.image.id]?.status !== "done");

  // The sharpened PNG of each image that is sharpened, for the PDF.
  async function sharpenedForPdf(): Promise<Map<string, SharpenedImage>> {
    const ready = new Map<string, SharpenedImage>();
    for (const use of wanted) {
      const state = states[use.image.id];
      if (state?.status !== "done") continue;
      ready.set(use.image.id, await sharpenedPng(use.image, state.result, use.printedWidthMm));
    }
    return ready;
  }

  return {
    uses,
    states,
    busy,
    choose: (imageId: string, on: boolean) =>
      setChoices((current) => ({ ...current, [imageId]: on })),
    sharpenedForPdf,
  };
}
