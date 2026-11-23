import type { Opening, OpeningType, PresetInfo, PresetResolver } from '../types';
import { defaultOpeningType } from './normalize';

function make(
  type: OpeningType,
  w: number,
  h: number,
  sill: number,
  extra: { split?: number } = {},
): PresetInfo {
  return { mount: 'opening', footprint: { w, d: 0.05, h }, sill, opening: { type, ...extra } };
}

/** Built-in opening presets, one or more per type. Sizes are width x height in metres. */
export const OPENING_PRESETS: Record<string, PresetInfo> = {
  'door-single-01': make('door-swing', 0.9, 2.1, 0),
  'door-double-01': make('door-double', 1.4, 2.2, 0, { split: 0.5 }),
  'door-double-unequal-01': make('door-double', 1.2, 2.2, 0, { split: 0.67 }),
  'door-sliding-01': make('door-sliding', 1.6, 2.2, 0),
  'door-folding-01': make('door-folding', 2.8, 2.6, 0),
  'door-rolling-01': make('door-rolling', 3.0, 2.8, 0),
  'opening-01': make('opening', 1.0, 2.2, 0),
  'window-01': make('window-fixed', 1.2, 1.4, 0.9),
  'window-casement-01': make('window-casement', 1.2, 1.4, 0.9),
  'window-sliding-01': make('window-sliding', 1.6, 1.4, 0.9),
  'window-awning-01': make('window-awning', 0.8, 0.6, 1.6),
};

/** Resolves the host's presets first, then the built-in opening presets. */
export function createPresetResolver(host?: PresetResolver): PresetResolver {
  return (id) => {
    const info = host?.(id);
    if (info) return info;
    return Object.hasOwn(OPENING_PRESETS, id) ? structuredClone(OPENING_PRESETS[id]) : undefined;
  };
}

/**
 * The opening `info` (an opening preset) makes at `base`: its size, sill, type, leaves and split.
 * Orientation the preset does not give stays as in `base`.
 */
export function presetOpening(
  info: PresetInfo,
  base: Pick<Opening, 'id' | 'wall' | 'preset' | 'offset' | 'hinge' | 'swing'>,
  sill = info.sill ?? 0,
): Opening {
  const made: Opening = {
    id: base.id,
    wall: base.wall,
    preset: base.preset,
    offset: base.offset,
    width: info.footprint.w,
    height: info.footprint.h,
    sill,
    type: info.opening?.type ?? defaultOpeningType(sill),
    hinge: info.opening?.hinge ?? base.hinge,
    swing: info.opening?.swing ?? base.swing,
  };
  if (info.opening?.leaves !== undefined) made.leaves = info.opening.leaves;
  if (info.opening?.split !== undefined) made.split = info.opening.split;
  return made;
}
