export const MIN_WALL_LENGTH = 0.3;
export const MIN_ROOM_AREA = 1.0;
export const OPENING_END_MARGIN = 0.1;
/** Largest allowed column width / depth (diameter for round columns), in meters. */
export const MAX_COLUMN_SIZE = 2;
/** Default floor slab thickness in meters. */
export const DEFAULT_SLAB_THICKNESS = 0.15;
export const XML_DECIMALS = 4;
export const FORMAT_VERSION = 1;
/**
 * Contact tolerance in meters for collision, containment and range checks.
 * Far above the XML rounding error (5e-5) so valid files stay valid after a
 * save / load round trip, and far below anything visible in a floor plan.
 */
export const GEOM_TOL = 1e-3;
