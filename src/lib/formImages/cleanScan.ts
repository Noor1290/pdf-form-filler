// Cleaning a scanned page: the paper made white, the "Scanned with
// CamScanner" footer, small specks and stray marks in the margins
// removed. Rule-based, and careful: text, lines, stamps, signatures,
// coats of arms and the form's own shading are never removed, and
// anything it is not sure about is left as it is.
//
// Works on RGBA pixels in place (it runs in a worker, see
// cleanScan.worker.ts). No screen code here.
import { colourAt, lightAt, saturation } from "@/lib/formImages/scanColour";
import { removeCamScannerFooter } from "@/lib/formImages/scanFooter";
import { whitenPaper } from "@/lib/formImages/whitenPaper";

export type CleanReport = {
  // Small isolated specks removed near the edges or in the margins.
  specks: number;
  // Grey or black marks removed along the very edge (scanner shadows).
  edgeMarks: number;
  // Short stray lines removed from the margins.
  marginLines: number;
  // The "Scanned with CamScanner" footer removed.
  footer: boolean;
};

export function cleanScan(data: Uint8ClampedArray, width: number, height: number): CleanReport {
  whitenPaper(data, width, height);
  // Before the specks, which could otherwise take bits of its letters.
  const footer = removeCamScannerFooter(data, width, height);
  return { ...removeSpecksAndMarks(data, width, height), footer };
}

// ----------------------------------------------------- specks and marks

// Ink: anything clearly darker than paper, or clearly coloured.
function isInk(data: Uint8ClampedArray, i: number): boolean {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const light = 0.299 * r + 0.587 * g + 0.114 * b;
  return light < 170 || (saturation(r, g, b) > 60 && light < 235);
}

// Any mark at all, faint ones included (the light edges of letters, faint
// print): what counts when making sure a speck is not part of something.
const isMarked = (data: Uint8ClampedArray, i: number) =>
  lightAt(data, i) < 225 || colourAt(data, i) > 40;

type Piece = {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  colour: number;
};

type Page = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  labels: Int32Array;
  pieces: (Piece | undefined)[];
  pxPerMm: number;
};

// A bit of ink lying wholly within a piece's outline and soft rim (a
// pen stroke breaks into bits) belongs to that piece.
function belongsTo(page: Page, piece: Piece, rim: number, label: number): boolean {
  const bit = page.pieces[label];
  return (
    !!bit &&
    bit.minX >= piece.minX - rim &&
    bit.maxX <= piece.maxX + rim &&
    bit.minY >= piece.minY - rim &&
    bit.maxY <= piece.maxY + rim
  );
}

// Every separate piece of ink (touching pixels, diagonals included) is
// looked at on its own. Removed:
//   - a mark along the very edge: grey or black, touching the edge and
//     wholly in the outer 3% (a scanner's shadow or a dark border), or
//     wholly within 1.5 mm of the edge without touching it (the paper's
//     own edge, caught by the scan);
//   - a speck: tiny (at most 1.5 mm across), not the darkest bit of a
//     fainter mark (a grey letter), with no other ink within 4 mm, and
//     either in the outer 8% of the page or with no ink between it and the
//     nearest edge. Out in the margin like that, a ruled line running past
//     it (a table's border) may be within the 4 mm;
//   - a short stray line in the margin: grey or black, straight across or
//     down, 3 to 30 mm long and at most 2 mm thick, in the outer 12% of
//     the page, nothing between it and the nearest edge, and no other mark
//     within 10 mm.
// Kept: anything coloured (stamps), anything with ink near it (text, a
// signature, a full stop), anything further into the page.
function removeSpecksAndMarks(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Omit<CleanReport, "footer"> {
  const { labels, pieces } = findPieces(data, width, height);
  // Scans have no reliable size in mm; the page's shorter side is taken
  // as A4's 210 mm, which is close for every common form size.
  const pxPerMm = Math.min(width, height) / 210;
  const page: Page = { data, width, height, labels, pieces, pxPerMm };
  const shorter = Math.min(width, height);
  const speckBand = Math.round(shorter * 0.08);
  const markBand = Math.round(shorter * 0.03);
  const lineBand = Math.round(shorter * 0.12);
  const rim = Math.max(1, Math.round(pxPerMm / 2));
  const report = { specks: 0, edgeMarks: 0, marginLines: 0 };

  const within = (piece: Piece, band: number) =>
    piece.maxX < band ||
    piece.minX >= width - band ||
    piece.maxY < band ||
    piece.minY >= height - band;

  // The edge first: once gone, a shadow no longer counts as ink near a
  // speck or a line.
  for (let id = 1; id < pieces.length; id++) {
    const piece = pieces[id];
    if (!piece || piece.colour / piece.area > 50) continue;
    const touchesEdge =
      piece.minX === 0 || piece.minY === 0 || piece.maxX === width - 1 || piece.maxY === height - 1;
    if ((touchesEdge && within(piece, markBand)) || within(piece, 1.5 * pxPerMm)) {
      // A wider soft rim: a mark along the edge fades out over more.
      erase(page, id, piece, Math.max(1, Math.round(pxPerMm)));
      report.edgeMarks++;
    }
  }

  for (let id = 1; id < pieces.length; id++) {
    const piece = pieces[id];
    if (!piece || piece.colour / piece.area > 50) continue;
    const wide = piece.maxX - piece.minX + 1;
    const tall = piece.maxY - piece.minY + 1;
    const across = Math.max(wide, tall);
    const thick = Math.min(wide, tall);

    if (across <= 1.5 * pxPerMm) {
      const inBand = within(piece, speckBand);
      const inMargin = clearToEdge(page, id, piece, rim);
      const onItsOwn =
        (inBand || inMargin) &&
        aloneWithin(page, id, piece, rim, 4 * pxPerMm, inMargin) &&
        !partOfFainterMark(page, id, piece, rim);
      if (onItsOwn) {
        erase(page, id, piece, rim);
        report.specks++;
      }
      continue;
    }

    const lineShaped =
      thick <= 2 * pxPerMm &&
      across >= 3 * pxPerMm &&
      across <= 30 * pxPerMm &&
      across >= thick * 4;
    if (
      lineShaped &&
      within(piece, lineBand) &&
      clearToEdge(page, id, piece, rim) &&
      aloneWithin(page, id, piece, rim, 10 * pxPerMm, false)
    ) {
      erase(page, id, piece, rim);
      report.marginLines++;
    }
  }
  return report;
}

// Labels touching ink pixels as pieces (two passes with union-find).
function findPieces(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { labels: Int32Array; pieces: (Piece | undefined)[] } {
  const labels = new Int32Array(width * height);
  let parent = new Int32Array(1024);
  let next = 1;
  const root = (label: number) => {
    while (parent[label] !== label) {
      parent[label] = parent[parent[label]];
      label = parent[label];
    }
    return label;
  };
  const join = (a: number, b: number) => {
    const ra = root(a);
    const rb = root(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!isInk(data, p * 4)) continue;
      // Neighbours already seen: left, and the three above.
      const seen = [
        x > 0 ? labels[p - 1] : 0,
        y > 0 && x > 0 ? labels[p - width - 1] : 0,
        y > 0 ? labels[p - width] : 0,
        y > 0 && x < width - 1 ? labels[p - width + 1] : 0,
      ].filter((label) => label > 0);
      if (seen.length === 0) {
        if (next >= parent.length) {
          const grown = new Int32Array(parent.length * 2);
          grown.set(parent);
          parent = grown;
        }
        parent[next] = next;
        labels[p] = next++;
        continue;
      }
      labels[p] = seen[0];
      for (const other of seen) join(seen[0], other);
    }
  }

  const pieces: (Piece | undefined)[] = [];
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] === 0) continue;
    const id = root(labels[p]);
    labels[p] = id;
    const x = p % width;
    const y = (p - x) / width;
    const i = p * 4;
    const piece = (pieces[id] ??= { area: 0, minX: x, minY: y, maxX: x, maxY: y, colour: 0 });
    piece.area++;
    piece.minX = Math.min(piece.minX, x);
    piece.maxX = Math.max(piece.maxX, x);
    piece.minY = Math.min(piece.minY, y);
    piece.maxY = Math.max(piece.maxY, y);
    piece.colour += saturation(data[i], data[i + 1], data[i + 2]);
  }
  return { labels, pieces };
}

// No ink between the piece (and its soft rim) and the page edge nearest
// to it, over the piece's own width.
function clearToEdge(page: Page, id: number, piece: Piece, rim: number): boolean {
  const { width, height, labels } = page;
  const gaps = [piece.minX, width - 1 - piece.maxX, piece.minY, height - 1 - piece.maxY];
  const nearest = gaps.indexOf(Math.min(...gaps));
  const box =
    nearest === 0
      ? { x0: 0, x1: piece.minX - rim - 1, y0: piece.minY - rim, y1: piece.maxY + rim }
      : nearest === 1
        ? { x0: piece.maxX + rim + 1, x1: width - 1, y0: piece.minY - rim, y1: piece.maxY + rim }
        : nearest === 2
          ? { x0: piece.minX - rim, x1: piece.maxX + rim, y0: 0, y1: piece.minY - rim - 1 }
          : { x0: piece.minX - rim, x1: piece.maxX + rim, y0: piece.maxY + rim + 1, y1: height - 1 };
  for (let y = Math.max(0, box.y0); y <= Math.min(height - 1, box.y1); y++) {
    for (let x = Math.max(0, box.x0); x <= Math.min(width - 1, box.x1); x++) {
      const label = labels[y * width + x];
      if (label !== 0 && label !== id) return false;
    }
  }
  return true;
}

// No other ink within `distance` of the piece's outline box. With
// `linesMayPass`, a straight ruled line running right past it (across the
// whole area looked at, at most 1 mm thick) does not count.
function aloneWithin(
  page: Page,
  id: number,
  piece: Piece,
  rim: number,
  distance: number,
  linesMayPass: boolean,
): boolean {
  const { width, height, labels, pxPerMm } = page;
  const x0 = Math.max(0, Math.floor(piece.minX - distance));
  const x1 = Math.min(width - 1, Math.ceil(piece.maxX + distance));
  const y0 = Math.max(0, Math.floor(piece.minY - distance));
  const y1 = Math.min(height - 1, Math.ceil(piece.maxY + distance));
  // Each other piece's part inside the area looked at.
  const others = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const label = labels[y * width + x];
      if (label === 0 || label === id || belongsTo(page, piece, rim, label)) continue;
      if (!linesMayPass) return false;
      const part = others.get(label);
      if (!part) {
        others.set(label, { minX: x, minY: y, maxX: x, maxY: y });
        continue;
      }
      part.minX = Math.min(part.minX, x);
      part.maxX = Math.max(part.maxX, x);
      part.minY = Math.min(part.minY, y);
      part.maxY = Math.max(part.maxY, y);
    }
  }
  for (const part of others.values()) {
    const straightDown = part.maxX - part.minX + 1 <= pxPerMm && part.minY === y0 && part.maxY === y1;
    const straightAcross = part.maxY - part.minY + 1 <= pxPerMm && part.minX === x0 && part.maxX === x1;
    if (!straightDown && !straightAcross) return false;
  }
  return true;
}

// The darkest bit of something larger and fainter (a grey letter, faint
// print): its faint surroundings reach beyond its soft rim.
function partOfFainterMark(page: Page, id: number, piece: Piece, rim: number): boolean {
  const { data, width, height, labels } = page;
  const x0 = Math.max(0, piece.minX - rim - 1);
  const x1 = Math.min(width - 1, piece.maxX + rim + 1);
  const y0 = Math.max(0, piece.minY - rim - 1);
  const y1 = Math.min(height - 1, piece.maxY + rim + 1);
  const areaWidth = x1 - x0 + 1;
  const seen = new Uint8Array(areaWidth * (y1 - y0 + 1));
  const stack: number[] = [];
  for (let y = piece.minY; y <= piece.maxY; y++) {
    for (let x = piece.minX; x <= piece.maxX; x++) {
      if (labels[y * width + x] !== id) continue;
      const local = (y - y0) * areaWidth + (x - x0);
      seen[local] = 1;
      stack.push(local);
    }
  }
  while (stack.length > 0) {
    const here = stack.pop()!;
    const hx = x0 + (here % areaWidth);
    const hy = y0 + Math.floor(here / areaWidth);
    if (hx === x0 || hx === x1 || hy === y0 || hy === y1) {
      // Reached past the rim (the page's own edge does not count).
      if ((hx === x0 && x0 > 0) || (hx === x1 && x1 < width - 1)) return true;
      if ((hy === y0 && y0 > 0) || (hy === y1 && y1 < height - 1)) return true;
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = hx + dx;
        const ny = hy + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const next = (ny - y0) * areaWidth + (nx - x0);
        if (seen[next] || !isMarked(data, (ny * width + nx) * 4)) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return false;
}

// White where the piece (and the bits belonging to it) was, and its soft
// grey rim (a little around them, only where there is no other ink). The
// piece is then gone: it no longer counts as ink near anything, and is not
// looked at again.
function erase(page: Page, id: number, piece: Piece, rim: number): void {
  const { data, labels, width, height } = page;
  const members = new Set([id]);
  for (let y = Math.max(0, piece.minY - rim); y <= Math.min(height - 1, piece.maxY + rim); y++) {
    for (let x = Math.max(0, piece.minX - rim); x <= Math.min(width - 1, piece.maxX + rim); x++) {
      const label = labels[y * width + x];
      if (label !== 0 && !members.has(label) && belongsTo(page, piece, rim, label)) members.add(label);
    }
  }
  const near = (x: number, y: number) => {
    for (let dy = -rim; dy <= rim; dy++) {
      for (let dx = -rim; dx <= rim; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (members.has(labels[ny * width + nx])) return true;
      }
    }
    return false;
  };

  // The bits reach up to a rim beyond the piece, and their rim one more.
  const gone: number[] = [];
  for (let y = Math.max(0, piece.minY - 2 * rim); y <= Math.min(height - 1, piece.maxY + 2 * rim); y++) {
    for (let x = Math.max(0, piece.minX - 2 * rim); x <= Math.min(width - 1, piece.maxX + 2 * rim); x++) {
      const p = y * width + x;
      const label = labels[p];
      if (label !== 0 ? !members.has(label) : !near(x, y)) continue;
      data[p * 4] = 255;
      data[p * 4 + 1] = 255;
      data[p * 4 + 2] = 255;
      if (label !== 0) gone.push(p);
    }
  }
  for (const p of gone) labels[p] = 0;
  for (const label of members) page.pieces[label] = undefined;
}
