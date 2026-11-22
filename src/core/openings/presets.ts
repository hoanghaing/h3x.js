import type { OpeningType, PresetInfo, PresetResolver } from '../types';

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
