import { useEffect, useRef } from "react";
import { loadPdfDocument, renderPdfPageToCanvas } from "@/lib/pdf";

type PdfCanvasProps = {
  source: File | Uint8Array;
  onError: (message: string) => void;
};

const PAGE_WIDTH = 800;

export function PdfCanvas({ source, onError }: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdf = await loadPdfDocument(source);
        if (cancelled || !canvasRef.current) return;
        await renderPdfPageToCanvas(pdf, 1, canvasRef.current, PAGE_WIDTH);
      } catch {
        if (!cancelled) onError("This file doesn't look like a PDF.");
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [source, onError]);

  return (
    <canvas
      ref={canvasRef}
      className="max-w-full rounded-lg border border-border shadow-sm"
    />
  );
}
