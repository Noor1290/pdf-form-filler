import { useEffect, useRef, useState } from "react";
import { loadPdfDocument, renderPdfPageToCanvas } from "@/lib/pdf";

type PdfCanvasProps = {
  source: File | Uint8Array;
  onError: (message: string) => void;
};

const PAGE_WIDTH = 800;

export function PdfCanvas({ source, onError }: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Only decides whether the loading placeholder shows. How the page is
  // drawn, and at what size, is exactly as before.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdf = await loadPdfDocument(source);
        if (cancelled || !canvasRef.current) return;
        await renderPdfPageToCanvas(pdf, 1, canvasRef.current, PAGE_WIDTH);
      } catch {
        if (!cancelled) onError("This file doesn't look like a PDF.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [source, onError]);

  // The page sits on a plain surface with a thin line around it and nothing
  // else: no shadow, blur or tint, so it looks as it will print. Until it
  // has been drawn, a placeholder of about the same shape holds its place.
  return (
    <div
      className={
        loading
          ? "on-paper relative h-140 w-200 max-w-full"
          : "on-paper relative max-w-full"
      }
    >
      {loading && (
        <div aria-hidden="true" className="skeleton absolute inset-0" />
      )}
      <canvas
        ref={canvasRef}
        className={
          loading
            ? "invisible max-w-full rounded-lg border border-border"
            : "max-w-full rounded-lg border border-border"
        }
      />
    </div>
  );
}
