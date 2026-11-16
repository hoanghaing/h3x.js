/** Font size (px) of dimension labels; the plan sizes label hit rects from it. */
export const DIMENSION_FONT_PX = 12;
/** Radius (px) of a node handle. */
export const NODE_RADIUS_PX = 5;

/** Default stylesheet, every rule scoped under the root class `prefix`. */
export function DEFAULT_CSS(prefix: string): string {
  const p = `.${prefix}`;
  return `
${p} { background: #fafaf9; user-select: none; font-family: system-ui, sans-serif; }
${p} .${prefix}-grid-minor { stroke: #e7e5e4; stroke-width: 1; fill: none; }
${p} .${prefix}-grid-major { stroke: #d6d3d1; stroke-width: 1; fill: none; }
${p} .${prefix}-room polygon { fill: #f5f5f4; stroke: none; }
${p} .${prefix}-room text { fill: #57534e; font-size: 13px; text-anchor: middle; }
${p} .${prefix}-room .${prefix}-room-area { font-size: 11px; fill: #78716c; }
${p} .${prefix}-wall polygon, ${p} .${prefix}-join polygon { fill: #44403c; stroke: #292524; stroke-width: 1; }
${p} .${prefix}-join polygon { stroke: none; }
${p} .${prefix}-opening .${prefix}-opening-gap { fill: #fafaf9; stroke: none; }
${p} .${prefix}-opening path { fill: none; stroke: #292524; stroke-width: 1.5; }
${p} .${prefix}-opening .${prefix}-opening-arc { stroke-width: 1; stroke-dasharray: 4 3; }
${p} .${prefix}-item polygon { fill: none; stroke: #78716c; stroke-width: 1; }
${p} .${prefix}-dimension path { fill: none; stroke: #2563eb; stroke-width: 1; }
${p} .${prefix}-dimension text { fill: #1d4ed8; font-size: ${DIMENSION_FONT_PX}px; text-anchor: middle; dominant-baseline: central; paint-order: stroke; stroke: #fafaf9; stroke-width: 3px; }
${p} .${prefix}-node circle { fill: #fff; stroke: #2563eb; stroke-width: 1.5; opacity: 0; }
${p} .${prefix}-node:hover circle, ${p} .${prefix}-node.${prefix}-selected circle { opacity: 1; }
${p} .${prefix}-selected polygon { stroke: #2563eb; stroke-width: 2; }
${p} .${prefix}-invalid polygon, ${p} .${prefix}-invalid path { stroke: #dc2626; }
${p} .${prefix}-rejected polygon, ${p} .${prefix}-rejected path { stroke: #dc2626; stroke-width: 3; }
${p} .${prefix}-guide { stroke: #db2777; stroke-width: 1; stroke-dasharray: 4 3; }
`.trimStart();
}
