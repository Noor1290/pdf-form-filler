// A field's outline is moved by dragging it and opens its settings when it
// is clicked. The browser also sends a click when a drag ends on the
// outline; that click must not open the settings (known issue 2). Plain
// clicks, with no move, still do.
//
//   const guard = useMemo(createDragClickGuard, []);
//   onDragStop: guard.dragStopped(box.id, moved)
//   onClick:    if (guard.shouldOpen(box.id)) open it
export function createDragClickGuard() {
  let justMoved: string | null = null;
  return {
    dragStopped(id: string, moved: boolean) {
      if (!moved) return;
      justMoved = id;
      // The click that ends a drag arrives straight after it; if none does
      // (the pointer was let go outside the outline), the next click counts.
      setTimeout(() => {
        if (justMoved === id) justMoved = null;
      }, 0);
    },
    shouldOpen(id: string): boolean {
      if (justMoved === id) {
        justMoved = null;
        return false;
      }
      return true;
    },
  };
}

// Whether a drag that stopped at (x, y) moved the outline from (fromX, fromY).
export function hasMoved(fromX: number, fromY: number, x: number, y: number): boolean {
  return Math.abs(x - fromX) > 0.5 || Math.abs(y - fromY) > 0.5;
}
