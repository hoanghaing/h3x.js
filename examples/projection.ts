export type Projection = 'perspective' | 'orthographic';

/** The projection the toggle button switches to, derived from the viewer's current one. */
export function nextProjection(current: Projection): Projection {
  return current === 'perspective' ? 'orthographic' : 'perspective';
}

/** Status text for a projection. */
export function projectionLabel(p: Projection): string {
  return p === 'orthographic' ? 'Chế độ trực giao' : 'Chế độ phối cảnh';
}
