// Cleaning a scanned page: the paper made white, and small specks and
// marks at the edges removed. Rule-based, and careful: text, lines,
// stamps, signatures and coats of arms are never removed, and anything
// it is not sure about is left as it is.
//
// Works on RGBA pixels in place (it runs in a worker, see
// cleanScan.worker.ts). No screen code here.

export type CleanReport = {
  // Small isolated specks removed near the edges.
  specks: number;
  // Grey or black marks removed along the very edge (scanner shadows).
  edgeMarks: number;
};

const luminance = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const saturation = (r: number, g: number, b: number) =>
  Math.max(r, g, b) - Math.min(r, g, b);

export function cleanScan(data: Uint8ClampedArray, width: number, height: number): CleanReport {
  whitenPaper(data, width, height);
  return removeEdgeSpecksAndMarks(data, width, height);
}

// ------------------------------------------------------------ the paper

// The paper's own colour is measured area by area (a grid of about 40
// across), as the brightest tenth of each area: lighting is uneven and
// paper yellows unevenly. Each pixel is then scaled by what makes its
// area's paper white, so ink keeps its darkness and stamps their colour
// relative to the paper. What ends up very close to white and grey is
// made exactly white.
function whitenPaper(data: Uint8ClampedArray, width: number, height: number): void {
  const block = Math.max(16, Math.round(Math.min(width, height) / 40));
  const across = Math.ceil(width / block);
  const down = Math.ceil(height / block);
  const paper = new Float32Array(across * down * 3);
  const paperLight = new Float32Array(across * down);

  for (let by = 0; by < down; by++) {
    for (let bx = 0; bx < across; bx++) {
      const histogram = new Uint32Array(256);
      const x0 = bx * block;
      const y0 = by * block;
      const x1 = Math.min(width, x0 + block);
      const y1 = Math.min(height, y0 + block);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          histogram[Math.round(luminance(data[i], data[i + 1], data[i + 2]))]++;
        }
      }
      // The light level above which the brightest tenth lies.
      const tenth = ((x1 - x0) * (y1 - y0)) / 10;
      let level = 255;
      for (let seen = 0; level > 0 && seen + histogram[level] < tenth; level--) {
        seen += histogram[level];
      }
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          // Rounded as in the histogram, so the brightest tenth found there
          // is the one averaged here.
          if (Math.round(luminance(data[i], data[i + 1], data[i + 2])) < level) continue;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
      }
      const cell = by * across + bx;
      // Never empty (the brightest level always has its pixels), but an
      // area without a measure must not spread "not a number" to the page.
      if (count === 0) {
        paperLight[cell] = 0;
        continue;
      }
      paper[cell * 3] = r / count;
      paper[cell * 3 + 1] = g / count;
      paper[cell * 3 + 2] = b / count;
      paperLight[cell] = luminance(r / count, g / count, b / count);
    }
  }

  fillAreasWithoutPaper(paper, paperLight, across, down);
  smooth(paper, across, down);
  smooth(paper, across, down);

  // The paper colour for each pixel lies between the centres of the areas
  // around it (bilinear). Worked out once per row, then along it.
  const row = new Float32Array(across * 3);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(down - 1, Math.max(0, y / block - 0.5));
    const y0 = Math.floor(gy);
    const y1 = Math.min(down - 1, y0 + 1);
    const fy = gy - y0;
    for (let k = 0; k < across * 3; k++) {
      row[k] = paper[y0 * across * 3 + k] * (1 - fy) + paper[y1 * across * 3 + k] * fy;
    }
    for (let x = 0; x < width; x++) {
      const gx = Math.min(across - 1, Math.max(0, x / block - 0.5));
      const x0 = Math.floor(gx);
      const x1 = Math.min(across - 1, x0 + 1);
      const fx = gx - x0;
      const i = (y * width + x) * 4;
      const localR = row[x0 * 3] * (1 - fx) + row[x1 * 3] * fx;
      const localG = row[x0 * 3 + 1] * (1 - fx) + row[x1 * 3 + 1] * fx;
      const localB = row[x0 * 3 + 2] * (1 - fx) + row[x1 * 3 + 2] * fx;
      // Never more than doubled, so a dark page is not blown out.
      const gain = (value: number) => Math.min(2, 255 / Math.max(1, value));
      // Dark ink gets the same gain on red, green and blue, so black stays
      // black and not tinted; the paper gets each colour's own.
      const even = gain(luminance(localR, localG, localB));
      const paperLike = luminance(data[i], data[i + 1], data[i + 2]) / 255;
      data[i] = data[i] * (even + (gain(localR) - even) * paperLike);
      data[i + 1] = data[i + 1] * (even + (gain(localG) - even) * paperLike);
      data[i + 2] = data[i + 2] * (even + (gain(localB) - even) * paperLike);
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (luminance(r, g, b) >= 236 && saturation(r, g, b) <= 28) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
      }
    }
  }
}

// An area that is nearly all ink (a black box, a large stamp) has no paper
// to measure: it takes the paper colour of the areas around it.
function fillAreasWithoutPaper(
  paper: Float32Array,
  paperLight: Float32Array,
  across: number,
  down: number,
): void {
  const sorted = Array.from(paperLight).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  const known = new Uint8Array(across * down);
  for (let cell = 0; cell < known.length; cell++) {
    known[cell] = paperLight[cell] >= typical * 0.7 ? 1 : 0;
  }
  for (let pass = 0; pass < across + down; pass++) {
    let missing = 0;
    for (let cy = 0; cy < down; cy++) {
      for (let cx = 0; cx < across; cx++) {
        const cell = cy * across + cx;
        if (known[cell]) continue;
        const sum = [0, 0, 0];
        let count = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= across || ny >= down) continue;
          const other = ny * across + nx;
          if (known[other] !== 1) continue;
          for (let c = 0; c < 3; c++) sum[c] += paper[other * 3 + c];
          count++;
        }
        if (count === 0) {
          missing++;
          continue;
        }
        for (let c = 0; c < 3; c++) paper[cell * 3 + c] = sum[c] / count;
        // Filled this pass: counts as known from the next pass on.
        known[cell] = 2;
      }
    }
    for (let cell = 0; cell < known.length; cell++) if (known[cell] === 2) known[cell] = 1;
    if (missing === 0) return;
  }
}

function smooth(paper: Float32Array, across: number, down: number): void {
  const before = paper.slice();
  for (let cy = 0; cy < down; cy++) {
    for (let cx = 0; cx < across; cx++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= across || ny >= down) continue;
            sum += before[(ny * across + nx) * 3 + c];
            count++;
          }
        }
        paper[(cy * across + cx) * 3 + c] = sum / count;
      }
    }
  }
}

// ----------------------------------------------------- specks and marks

// Ink: anything clearly darker than paper, or clearly coloured.
function isInk(data: Uint8ClampedArray, i: number): boolean {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const light = luminance(r, g, b);
  return light < 170 || (saturation(r, g, b) > 60 && light < 235);
}

type Piece = {
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  colour: number;
};

// Every separate piece of ink (touching pixels, diagonals included) is
// looked at on its own. Removed, and only near the page's edges:
//   - a speck: tiny (at most 1.5 mm across) with no other ink within 4 mm,
//     in the outer 8% of the page;
//   - a mark along the very edge: grey or black, touching the edge, and
//     wholly in the outer 3% (a scanner's shadow or a dark border).
// Kept: anything coloured (stamps), anything with ink near it (text, a
// signature), anything reaching further into the page.
function removeEdgeSpecksAndMarks(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): CleanReport {
  const { labels, pieces } = findPieces(data, width, height);
  // Scans have no reliable size in mm; the page's shorter side is taken
  // as A4's 210 mm, which is close for every common form size.
  const pxPerMm = Math.min(width, height) / 210;
  const speckBand = Math.round(Math.min(width, height) * 0.08);
  const markBand = Math.round(Math.min(width, height) * 0.03);
  const report: CleanReport = { specks: 0, edgeMarks: 0 };

  const within = (piece: Piece, band: number) =>
    piece.maxX < band ||
    piece.minX >= width - band ||
    piece.maxY < band ||
    piece.minY >= height - band;

  for (let id = 1; id < pieces.length; id++) {
    const piece = pieces[id];
    if (!piece || piece.colour / piece.area > 50) continue;
    const across = Math.max(piece.maxX - piece.minX + 1, piece.maxY - piece.minY + 1);

    const touchesEdge =
      piece.minX === 0 || piece.minY === 0 || piece.maxX === width - 1 || piece.maxY === height - 1;
    if (touchesEdge && within(piece, markBand)) {
      erase(data, labels, width, height, id, piece, Math.max(1, Math.round(pxPerMm / 2)));
      report.edgeMarks++;
      continue;
    }

    const tiny = across <= 1.5 * pxPerMm;
    if (tiny && within(piece, speckBand) && alone(labels, width, height, id, piece, 4 * pxPerMm)) {
      erase(data, labels, width, height, id, piece, Math.max(1, Math.round(pxPerMm / 2)));
      report.specks++;
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

// No other ink within `distance` pixels of the piece's outline box.
function alone(
  labels: Int32Array,
  width: number,
  height: number,
  id: number,
  piece: Piece,
  distance: number,
): boolean {
  const x0 = Math.max(0, Math.floor(piece.minX - distance));
  const x1 = Math.min(width - 1, Math.ceil(piece.maxX + distance));
  const y0 = Math.max(0, Math.floor(piece.minY - distance));
  const y1 = Math.min(height - 1, Math.ceil(piece.maxY + distance));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const label = labels[y * width + x];
      if (label !== 0 && label !== id) return false;
    }
  }
  return true;
}

// White where the piece was, and its soft grey rim (a little around it,
// only where there is no other ink).
function erase(
  data: Uint8ClampedArray,
  labels: Int32Array,
  width: number,
  height: number,
  id: number,
  piece: Piece,
  rim: number,
): void {
  for (let y = Math.max(0, piece.minY - rim); y <= Math.min(height - 1, piece.maxY + rim); y++) {
    for (let x = Math.max(0, piece.minX - rim); x <= Math.min(width - 1, piece.maxX + rim); x++) {
      const p = y * width + x;
      const label = labels[p];
      if (label !== id && label !== 0) continue;
      if (label === 0 && !nearPiece(labels, width, height, x, y, id, rim)) continue;
      data[p * 4] = 255;
      data[p * 4 + 1] = 255;
      data[p * 4 + 2] = 255;
    }
  }
}

function nearPiece(
  labels: Int32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  id: number,
  rim: number,
): boolean {
  for (let dy = -rim; dy <= rim; dy++) {
    for (let dx = -rim; dx <= rim; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (labels[ny * width + nx] === id) return true;
    }
  }
  return false;
}
