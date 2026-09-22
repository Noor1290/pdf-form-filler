export type PixelRect = { x: number; y: number; width: number; height: number };
export type PointRect = { x: number; y: number; width: number; height: number };

// Boxes are stored in PDF point units (top-left origin, scale 1) so they
// stay correct regardless of on-screen render size — these convert to/from
// the pixel space a canvas rendered at a given width is actually shown in.
export function makeUnitConverters(
  pageWidthPoints: number,
  canvasWidthPixels: number,
) {
  const pointsPerPixel = pageWidthPoints / canvasWidthPixels;

  function pixelToPointRect(rect: PixelRect): PointRect {
    return {
      x: rect.x * pointsPerPixel,
      y: rect.y * pointsPerPixel,
      width: rect.width * pointsPerPixel,
      height: rect.height * pointsPerPixel,
    };
  }

  function pointToPixelRect(rect: PointRect): PixelRect {
    const pixelsPerPoint = 1 / pointsPerPixel;
    return {
      x: rect.x * pixelsPerPoint,
      y: rect.y * pixelsPerPoint,
      width: rect.width * pixelsPerPoint,
      height: rect.height * pixelsPerPoint,
    };
  }

  function pointsToPixels(points: number): number {
    return points / pointsPerPixel;
  }

  return { pointsPerPixel, pixelToPointRect, pointToPixelRect, pointsToPixels };
}
