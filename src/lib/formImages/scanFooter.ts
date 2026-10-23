// The "Scanned with CamScanner" footer the CamScanner app prints at the
// bottom left of every page: a square "CS" badge, then those three words,
// in plain light grey. Removed only when everything about it matches;
// anything unsure is left as it is. Works on RGBA pixels in place, after
// the paper is made white (see cleanScan.ts).
import { colourAt, lightAt } from "@/lib/formImages/scanColour";

type Piece = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
  light: number;
  darkest: number;
  colour: number;
};

// The three words' widths as shares of their total, as CamScanner prints
// them; measured on a real CamScanner page.
const WORD_SHARES = [0.337, 0.159, 0.504];
// How many letters each word shows as separate pieces ("i" with its dot
// is one; letters printed touching are one).
const WORD_LETTERS = [
  [5, 7],
  [3, 4],
  [8, 10],
];

const isMarked = (data: Uint8ClampedArray, i: number) =>
  lightAt(data, i) < 225 || colourAt(data, i) > 40;

// True when the footer was found and removed.
export function removeCamScannerFooter(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): boolean {
  // Looked for in the bottom-left corner only: the left half, and the
  // bottom 12% of the page's width.
  const region = {
    minX: 0,
    minY: Math.max(0, height - Math.round(width * 0.12)),
    maxX: Math.round(width * 0.5) - 1,
    maxY: height - 1,
  };
  const pieces = piecesIn(data, width, region);
  const footer = matchFooter(pieces, width, height);
  if (!footer) return false;

  // White over the footer and a little around it, where nothing else is
  // (checked in matchFooter).
  const pad = Math.round(footer.badge * 0.15);
  for (let y = Math.max(0, footer.box.minY - pad); y <= Math.min(height - 1, footer.box.maxY + pad); y++) {
    for (let x = Math.max(0, footer.box.minX - pad); x <= Math.min(width - 1, footer.box.maxX + pad); x++) {
      const i = (y * width + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    }
  }
  return true;
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

// Each rule below must hold, or the footer is not there.
function matchFooter(
  pieces: Piece[],
  width: number,
  height: number,
): { box: Box; badge: number } | null {
  // The badge: a hollow square at the very bottom left, 1% to 5% of the
  // page's width, with its "CS" (one to three pieces) inside.
  const badge = pieces.find((piece) => {
    const wide = piece.maxX - piece.minX + 1;
    const tall = piece.maxY - piece.minY + 1;
    const size = Math.max(wide, tall);
    return (
      Math.abs(wide - tall) <= size * 0.15 &&
      size >= width * 0.01 &&
      size <= width * 0.05 &&
      piece.minX <= size &&
      height - 1 - piece.maxY <= size &&
      piece.area <= size * size * 0.6
    );
  });
  if (!badge) return null;
  const size = Math.max(badge.maxX - badge.minX + 1, badge.maxY - badge.minY + 1);
  const inside = pieces.filter(
    (piece) =>
      piece !== badge &&
      piece.minX > badge.minX &&
      piece.maxX < badge.maxX &&
      piece.minY > badge.minY &&
      piece.maxY < badge.maxY,
  );
  if (inside.length < 1 || inside.length > 3) return null;

  // The words: pieces beside the badge, within its height, one after the
  // other with no wide gap, starting close to the badge.
  const beside = pieces
    .filter((piece) => piece.minX > badge.maxX && piece.minY >= badge.minY && piece.maxY <= badge.maxY)
    .sort((a, b) => a.minX - b.minX);
  const text: Piece[] = [];
  let reach = badge.maxX + size * 0.5;
  for (const piece of beside) {
    if (piece.minX > reach) break;
    text.push(piece);
    reach = Math.max(reach, piece.maxX + size * 0.5);
  }
  const letters = lettersOf(text);
  if (letters.length < 16) return null;

  // On one line: every letter stands on the same baseline (none of these
  // words has a letter going below it), the line is 30% to 60% of the
  // badge's height and centred on it.
  const baseline = Math.max(...letters.map((letter) => letter.maxY));
  if (letters.some((letter) => baseline - letter.maxY > size * 0.06)) return null;
  const top = Math.min(...letters.map((letter) => letter.minY));
  const lineHeight = baseline - top + 1;
  if (lineHeight < size * 0.3 || lineHeight > size * 0.6) return null;
  if (Math.abs((top + baseline) / 2 - (badge.minY + badge.maxY) / 2) > size * 0.15) return null;

  // Three words, of the right widths and letter counts.
  const words = wordsOf(letters, size * 0.13);
  if (words.length !== 3) return null;
  const widths = words.map((word) => word[word.length - 1].maxX - word[0].minX + 1);
  const total = widths.reduce((sum, value) => sum + value, 0);
  for (let w = 0; w < 3; w++) {
    if (Math.abs(widths[w] / total - WORD_SHARES[w]) > 0.05) return null;
    const [fewest, most] = WORD_LETTERS[w];
    if (words[w].length < fewest || words[w].length > most) return null;
  }

  // Plain light grey, never black ink or colour. (Grey printed on yellowed
  // paper keeps a slight tint once the paper is made white; a pen's blue
  // is far stronger.)
  const all = [badge, ...inside, ...text];
  const area = all.reduce((sum, piece) => sum + piece.area, 0);
  const light = all.reduce((sum, piece) => sum + piece.light, 0) / area;
  const colour = all.reduce((sum, piece) => sum + piece.colour, 0) / area;
  if (light < 140 || colour > 30 || all.some((piece) => piece.darkest < 120)) return null;

  // Nothing else near it: no other mark within half the badge's size.
  const box = {
    minX: badge.minX,
    minY: Math.min(badge.minY, top),
    maxX: Math.max(...text.map((piece) => piece.maxX)),
    maxY: Math.max(badge.maxY, baseline),
  };
  const near = size * 0.5;
  const footerPieces = new Set(all);
  const crowded = pieces.some(
    (piece) =>
      !footerPieces.has(piece) &&
      piece.maxX >= box.minX - near &&
      piece.minX <= box.maxX + near &&
      piece.maxY >= box.minY - near &&
      piece.minY <= box.maxY + near,
  );
  if (crowded) return null;
  return { box, badge: size };
}

// Pieces side by side in x make one letter ("i" and its dot).
function lettersOf(text: Piece[]): Box[] {
  const letters: Box[] = [];
  for (const piece of text) {
    const last = letters[letters.length - 1];
    if (last && piece.minX <= last.maxX) {
      last.maxX = Math.max(last.maxX, piece.maxX);
      last.minY = Math.min(last.minY, piece.minY);
      last.maxY = Math.max(last.maxY, piece.maxY);
      continue;
    }
    letters.push({ minX: piece.minX, minY: piece.minY, maxX: piece.maxX, maxY: piece.maxY });
  }
  return letters;
}

// Letters further apart than `gap` start a new word.
function wordsOf(letters: Box[], gap: number): Box[][] {
  const words: Box[][] = [];
  for (const letter of letters) {
    const word = words[words.length - 1];
    if (word && letter.minX - word[word.length - 1].maxX - 1 <= gap) word.push(letter);
    else words.push([letter]);
  }
  return words;
}

// The separate marks in a part of the page (touching pixels, diagonals
// included), each with its outline box, light and colour.
function piecesIn(data: Uint8ClampedArray, width: number, region: Box): Piece[] {
  const regionWidth = region.maxX - region.minX + 1;
  const regionHeight = region.maxY - region.minY + 1;
  const seen = new Uint8Array(regionWidth * regionHeight);
  const pieces: Piece[] = [];
  const stack: number[] = [];
  for (let start = 0; start < seen.length; start++) {
    if (seen[start]) continue;
    const sx = start % regionWidth;
    const sy = (start - sx) / regionWidth;
    if (!isMarked(data, ((region.minY + sy) * width + region.minX + sx) * 4)) continue;
    const piece: Piece = { minX: width, minY: Infinity, maxX: 0, maxY: 0, area: 0, light: 0, darkest: 255, colour: 0 };
    seen[start] = 1;
    stack.push(start);
    while (stack.length > 0) {
      const here = stack.pop()!;
      const hx = here % regionWidth;
      const hy = (here - hx) / regionWidth;
      const x = region.minX + hx;
      const y = region.minY + hy;
      const i = (y * width + x) * 4;
      const light = lightAt(data, i);
      piece.minX = Math.min(piece.minX, x);
      piece.maxX = Math.max(piece.maxX, x);
      piece.minY = Math.min(piece.minY, y);
      piece.maxY = Math.max(piece.maxY, y);
      piece.area++;
      piece.light += light;
      piece.darkest = Math.min(piece.darkest, light);
      piece.colour += colourAt(data, i);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = hx + dx;
          const ny = hy + dy;
          if (nx < 0 || ny < 0 || nx >= regionWidth || ny >= regionHeight) continue;
          const next = ny * regionWidth + nx;
          if (seen[next]) continue;
          if (!isMarked(data, ((region.minY + ny) * width + region.minX + nx) * 4)) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    pieces.push(piece);
  }
  return pieces;
}
