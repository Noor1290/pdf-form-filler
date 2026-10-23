// Making a scanned page's paper white, and keeping the light shading that
// is part of the form (a grey or tinted band behind a section's header).
// Works on RGBA pixels in place; see cleanScan.ts.
import { luminance, saturation } from "@/lib/formImages/scanColour";

// The paper's own colour is measured area by area (a grid of about 40
// across), as the brightest tenth of each area: lighting is uneven and
// paper yellows unevenly. Each pixel is then scaled by what makes its
// area's paper white, so ink keeps its darkness and stamps their colour
// relative to the paper. What ends up very close to white and grey is
// made exactly white, except in the form's own shaded areas.
export function whitenPaper(data: Uint8ClampedArray, width: number, height: number): void {
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
  liftShadedAreas(paper, paperLight, across, down);
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
    }
  }

  const shaded = findShading(data, width, height);
  for (let p = 0; p < width * height; p++) {
    if (shaded[p]) continue;
    const i = p * 4;
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

// An area wholly inside a lightly shaded band (taller than an area) would
// take the shading for its paper and whiten it away. A neighbouring area
// that is only a little lighter is the real paper: the area takes its
// colour. A much lighter neighbour means a shadow on the page, which is
// left to be evened out as before.
function liftShadedAreas(
  paper: Float32Array,
  paperLight: Float32Array,
  across: number,
  down: number,
): void {
  const before = paper.slice();
  for (let cy = 0; cy < down; cy++) {
    for (let cx = 0; cx < across; cx++) {
      const cell = cy * across + cx;
      let lightest = cell;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= across || ny >= down) continue;
          const other = ny * across + nx;
          if (paperLight[other] > paperLight[lightest]) lightest = other;
        }
      }
      if (paperLight[lightest] - paperLight[cell] > 18) continue;
      for (let c = 0; c < 3; c++) paper[cell * 3 + c] = before[lightest * 3 + c];
    }
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

// ------------------------------------------------------------ shading

// The form's own light shading: the pixels it covers (1) are not made
// white. Looked at in squares of about 1 mm. A square is shaded when its
// middle light level is clearly below the page's paper, and even its
// darker quarter is still light (a line through white paper is not).
// Shaded squares that touch form an area; it counts as the form's shading
// when it is a filled rectangle (the dark letters of a header inside it
// count as part of it) at least 10 mm by 3 mm, away from the page's edges
// (a shadow along an edge is not the form's). Anything else, a smudge or
// faint marks, is made white as before.
function findShading(data: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const size = Math.max(4, Math.round(Math.min(width, height) / 210));
  const across = Math.ceil(width / size);
  const down = Math.ceil(height / size);
  const { middle, darkQuarter } = lightOfSquares(data, width, height, size, across, down);

  const counts = new Uint32Array(256);
  for (const level of middle) counts[level]++;
  let paperLevel = 255;
  for (let level = 0; level < 256; level++) if (counts[level] > counts[paperLevel]) paperLevel = level;

  // 1 shaded, 2 dark (ink), 0 paper.
  const kind = new Uint8Array(across * down);
  for (let square = 0; square < kind.length; square++) {
    if (middle[square] > paperLevel - 7) continue;
    kind[square] = middle[square] >= 180 && darkQuarter[square] >= 200 ? 1 : 2;
  }

  const edge = Math.round(Math.min(across, down) * 0.03);
  const shaded = new Uint8Array(width * height);
  const seen = new Uint8Array(across * down);
  for (let start = 0; start < kind.length; start++) {
    if (kind[start] !== 1 || seen[start]) continue;
    const area = squaresTouching(kind, seen, across, down, start);
    const wide = area.maxX - area.minX + 1;
    const tall = area.maxY - area.minY + 1;
    // Squares are about 1 mm.
    if (Math.min(wide, tall) < 3 || Math.max(wide, tall) < 10) continue;
    if (
      area.minX < edge ||
      area.minY < edge ||
      area.maxX >= across - edge ||
      area.maxY >= down - edge
    ) {
      continue;
    }
    let filled = 0;
    for (let sy = area.minY; sy <= area.maxY; sy++) {
      for (let sx = area.minX; sx <= area.maxX; sx++) if (kind[sy * across + sx] !== 0) filled++;
    }
    if (filled < wide * tall * 0.7) continue;
    for (let y = area.minY * size; y < Math.min(height, (area.maxY + 1) * size); y++) {
      shaded.fill(1, y * width + area.minX * size, y * width + Math.min(width, (area.maxX + 1) * size));
    }
  }
  return shaded;
}

// Each square's middle light level, and the level its darkest quarter
// lies below.
function lightOfSquares(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  size: number,
  across: number,
  down: number,
): { middle: Uint8Array; darkQuarter: Uint8Array } {
  const middle = new Uint8Array(across * down);
  const darkQuarter = new Uint8Array(across * down);
  const histogram = new Uint32Array(256);
  for (let sy = 0; sy < down; sy++) {
    for (let sx = 0; sx < across; sx++) {
      histogram.fill(0);
      const x1 = Math.min(width, (sx + 1) * size);
      const y1 = Math.min(height, (sy + 1) * size);
      let count = 0;
      for (let y = sy * size; y < y1; y++) {
        for (let x = sx * size; x < x1; x++) {
          const i = (y * width + x) * 4;
          histogram[Math.round(luminance(data[i], data[i + 1], data[i + 2]))]++;
          count++;
        }
      }
      let level = 0;
      let seen = histogram[0];
      for (; seen * 4 < count; seen += histogram[++level]);
      darkQuarter[sy * across + sx] = level;
      for (; seen * 2 < count; seen += histogram[++level]);
      middle[sy * across + sx] = level;
    }
  }
  return { middle, darkQuarter };
}

// The shaded squares touching `start` (sideways or up and down), marked
// as seen, and the rectangle around them.
function squaresTouching(
  kind: Uint8Array,
  seen: Uint8Array,
  across: number,
  down: number,
  start: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const area = { minX: across, minY: down, maxX: 0, maxY: 0 };
  const queue = [start];
  seen[start] = 1;
  while (queue.length > 0) {
    const square = queue.pop()!;
    const sx = square % across;
    const sy = (square - sx) / across;
    area.minX = Math.min(area.minX, sx);
    area.maxX = Math.max(area.maxX, sx);
    area.minY = Math.min(area.minY, sy);
    area.maxY = Math.max(area.maxY, sy);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = sx + dx;
      const ny = sy + dy;
      if (nx < 0 || ny < 0 || nx >= across || ny >= down) continue;
      const other = ny * across + nx;
      if (kind[other] !== 1 || seen[other]) continue;
      seen[other] = 1;
      queue.push(other);
    }
  }
  return area;
}
