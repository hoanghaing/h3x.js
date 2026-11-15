import { describe, expect, it } from 'vitest';
import { nextProjection, projectionLabel } from '../../examples/projection';

describe('example projection toggle', () => {
  it('toggles from the viewer state', () => {
    expect(nextProjection('perspective')).toBe('orthographic');
    expect(nextProjection('orthographic')).toBe('perspective');
  });

  it('labels the current projection', () => {
    expect(projectionLabel('orthographic')).toBe('Chế độ trực giao');
    expect(projectionLabel('perspective')).toBe('Chế độ phối cảnh');
  });
});
