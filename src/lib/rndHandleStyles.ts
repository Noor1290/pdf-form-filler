import type { CSSProperties } from "react";

// react-rnd's default resize handles are near-invisible; make them clearly
// clickable per the non-technical-audience rule in CLAUDE.md.
const handleBase: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 2,
  background: "var(--color-primary)",
  border: "1px solid var(--color-background)",
};

export const resizeHandleStyles = {
  top: { ...handleBase, top: -5, cursor: "ns-resize" },
  bottom: { ...handleBase, bottom: -5, cursor: "ns-resize" },
  left: { ...handleBase, left: -5, cursor: "ew-resize" },
  right: { ...handleBase, right: -5, cursor: "ew-resize" },
  topLeft: { ...handleBase, top: -5, left: -5, cursor: "nwse-resize" },
  topRight: { ...handleBase, top: -5, right: -5, cursor: "nesw-resize" },
  bottomLeft: { ...handleBase, bottom: -5, left: -5, cursor: "nesw-resize" },
  bottomRight: { ...handleBase, bottom: -5, right: -5, cursor: "nwse-resize" },
};
