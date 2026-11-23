/** Font size (px) of dimension labels; the plan sizes label hit rects from it. */
export const DIMENSION_FONT_PX = 12;
/** Radius (px) of a node handle. */
export const NODE_RADIUS_PX = 5;

/** Fill token of walls lower than the storey height (parapets). */
export const WALL_LOW_FILL = '#a8a29e';

/** Default stylesheet, every rule scoped under the root class `prefix`. */
export function DEFAULT_CSS(prefix: string): string {
  const p = `.${prefix}`;
  return `
${p} { background: #fafaf9; user-select: none; touch-action: none; font-family: system-ui, sans-serif; }
${p} .${prefix}-grid-minor { stroke: #e7e5e4; stroke-width: 1; fill: none; }
${p} .${prefix}-grid-major { stroke: #d6d3d1; stroke-width: 1; fill: none; }
${p} .${prefix}-underlay polygon, ${p} .${prefix}-underlay circle { fill: none; stroke: #a8a29e; stroke-width: 1; opacity: 0.6; pointer-events: none; }
${p} .${prefix}-room path { fill: #f5f5f4; stroke: none; }
${p} .${prefix}-room text { fill: #57534e; font-size: 13px; text-anchor: middle; }
${p} .${prefix}-room .${prefix}-room-area { font-size: 11px; fill: #78716c; }
${p} .${prefix}-wall polygon, ${p} .${prefix}-join polygon { fill: #44403c; stroke: #292524; stroke-width: 1; }
${p} .${prefix}-wall-low polygon { fill: ${WALL_LOW_FILL}; }
${p} .${prefix}-join polygon { stroke: none; }
${p} .${prefix}-opening .${prefix}-opening-gap { fill: #fafaf9; stroke: none; }
${p} .${prefix}-opening path { fill: none; stroke: #292524; stroke-width: 1.5; }
${p} .${prefix}-opening .${prefix}-opening-arc { stroke-width: 1; stroke-dasharray: 4 3; }
${p} .${prefix}-opening.${prefix}-selected path { stroke: #2563eb; }
${p} .${prefix}-opening.${prefix}-selected .${prefix}-opening-gap { fill: #dbeafe; }
${p} .${prefix}-opening.${prefix}-invalid path, ${p} .${prefix}-opening.${prefix}-rejected path { stroke: #dc2626; }
${p} .${prefix}-opening.${prefix}-rejected path { stroke-width: 3; }
${p} .${prefix}-opening.${prefix}-invalid .${prefix}-opening-gap, ${p} .${prefix}-opening.${prefix}-rejected .${prefix}-opening-gap { fill: #fee2e2; }
${p} .${prefix}-ghost { opacity: 0.8; pointer-events: none; }
${p} .${prefix}-ghost-guides { pointer-events: none; }
${p} .${prefix}-ghost .${prefix}-opening-gap { fill: #dbeafe; stroke: none; }
${p} .${prefix}-ghost path { fill: none; stroke: #2563eb; stroke-width: 1.5; }
${p} .${prefix}-ghost .${prefix}-opening-arc { stroke-width: 1; stroke-dasharray: 4 3; }
${p} .${prefix}-ghost.${prefix}-invalid path { stroke: #dc2626; }
${p} .${prefix}-ghost.${prefix}-invalid .${prefix}-opening-gap { fill: #fee2e2; }
${p} .${prefix}-ghost-free .${prefix}-opening-lines { stroke-width: 4; }
${p} .${prefix}-column circle, ${p} .${prefix}-column polygon { fill: #a8a29e; stroke: #292524; stroke-width: 1; }
${p} .${prefix}-stair polygon, ${p} .${prefix}-stair path { fill: none; stroke: #44403c; stroke-width: 1; }
${p} .${prefix}-stair .${prefix}-stair-outline { stroke: #57534e; }
${p} .${prefix}-stair .${prefix}-stair-hidden { stroke-dasharray: 4 3; }
${p} .${prefix}-stair .${prefix}-stair-walk { stroke: #57534e; }
${p} .${prefix}-stair .${prefix}-stair-arrow { fill: #57534e; stroke: none; }
${p} .${prefix}-stair .${prefix}-stair-break { stroke: #292524; stroke-width: 1.5; }
${p} .${prefix}-stair-label { fill: #44403c; font-size: 11px; font-weight: 600; text-anchor: middle; dominant-baseline: central; paint-order: stroke; stroke: #fafaf9; stroke-width: 3px; }
${p} .${prefix}-underlay .${prefix}-stair-step { stroke-width: 0.75; }
${p} .${prefix}-underlay .${prefix}-stair-opening { stroke: #57534e; stroke-width: 1.5; opacity: 0.8; }
${p} .${prefix}-underlay .${prefix}-stair-label { fill: #78716c; }
${p} .${prefix}-stair.${prefix}-selected polygon, ${p} .${prefix}-stair.${prefix}-selected path { stroke: #2563eb; }
${p} .${prefix}-stair.${prefix}-selected .${prefix}-stair-outline { stroke-width: 2; }
${p} .${prefix}-stair.${prefix}-invalid polygon, ${p} .${prefix}-stair.${prefix}-invalid path { stroke: #dc2626; }
${p} .${prefix}-stair.${prefix}-rejected polygon, ${p} .${prefix}-stair.${prefix}-rejected path { stroke: #dc2626; }
${p} .${prefix}-stair.${prefix}-rejected .${prefix}-stair-outline { stroke-width: 3; }
${p} .${prefix}-stair.${prefix}-selected .${prefix}-stair-arrow { fill: #2563eb; stroke: none; }
${p} .${prefix}-stair.${prefix}-invalid .${prefix}-stair-arrow, ${p} .${prefix}-stair.${prefix}-rejected .${prefix}-stair-arrow { fill: #dc2626; stroke: none; }
${p} .${prefix}-roof path, ${p} .${prefix}-roof polygon { fill: none; stroke: #b45309; stroke-width: 1; }
${p} .${prefix}-roof .${prefix}-roof-eave { stroke-dasharray: 6 4; }
${p} .${prefix}-roof .${prefix}-roof-outline { stroke-width: 1.5; }
${p} .${prefix}-roof .${prefix}-roof-line { stroke-width: 0.75; }
${p} .${prefix}-roof .${prefix}-roof-arrow { fill: #b45309; stroke: none; }
${p} .${prefix}-roof .${prefix}-roof-post { fill: #78716c; stroke: #292524; }
${p} .${prefix}-roof .${prefix}-roof-light { stroke: none; opacity: 0.6; }
${p} .${prefix}-roof .${prefix}-roof-hatch { stroke: #0e7490; }
${p} .${prefix}-roof-label { fill: #92400e; font-size: 10px; text-anchor: middle; dominant-baseline: central; paint-order: stroke; stroke: #fafaf9; stroke-width: 3px; }
${p} .${prefix}-roof.${prefix}-selected path, ${p} .${prefix}-roof.${prefix}-selected polygon { stroke: #2563eb; }
${p} .${prefix}-roof.${prefix}-invalid path, ${p} .${prefix}-roof.${prefix}-rejected path { stroke: #dc2626; }
${p} .${prefix}-site polygon { fill: none; stroke: #78716c; stroke-width: 1.5; stroke-dasharray: 8 4; }
${p} .${prefix}-item polygon { fill: none; stroke: #78716c; stroke-width: 1; }
${p} .${prefix}-dimension path { fill: none; stroke: #2563eb; stroke-width: 1; }
${p} .${prefix}-dimension text { fill: #1d4ed8; font-size: ${DIMENSION_FONT_PX}px; text-anchor: middle; dominant-baseline: central; paint-order: stroke; stroke: #fafaf9; stroke-width: 3px; }
${p} .${prefix}-node circle { fill: #fff; stroke: #2563eb; stroke-width: 1.5; opacity: 0; }
${p} .${prefix}-node:hover circle, ${p} .${prefix}-node.${prefix}-selected circle { opacity: 1; }
${p} .${prefix}-selected polygon, ${p} .${prefix}-selected circle, ${p} .${prefix}-room.${prefix}-selected path { stroke: #2563eb; stroke-width: 2; }
${p} .${prefix}-invalid polygon, ${p} .${prefix}-invalid circle, ${p} .${prefix}-invalid path { stroke: #dc2626; }
${p} .${prefix}-warning polygon, ${p} .${prefix}-warning circle, ${p} .${prefix}-warning path { stroke: #d97706; }
${p} .${prefix}-opening.${prefix}-warning .${prefix}-opening-gap { fill: #fef3c7; }
${p} .${prefix}-rejected polygon, ${p} .${prefix}-rejected circle, ${p} .${prefix}-rejected path { stroke: #dc2626; stroke-width: 3; }
${p} .${prefix}-preview { stroke: #2563eb; stroke-width: 2; stroke-dasharray: 6 4; }
${p} .${prefix}-preview-label { fill: #1d4ed8; font-size: ${DIMENSION_FONT_PX}px; text-anchor: middle; dominant-baseline: central; paint-order: stroke; stroke: #fafaf9; stroke-width: 3px; }
${p} .${prefix}-roof-handle, ${p} .${prefix}-opening-handle { fill: #fff; stroke: #2563eb; stroke-width: 1.5; }
${p} .${prefix}-drop-target { fill: none; stroke: #db2777; stroke-width: 2; }
${p} .${prefix}-guide, ${p} .${prefix}-ghost-guide { stroke: #db2777; stroke-width: 1; stroke-dasharray: 4 3; }
`.trimStart();
}
