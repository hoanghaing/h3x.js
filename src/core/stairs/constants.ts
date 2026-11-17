/** Maximum riser height (m): risers n = ceil(rise / MAX_RISER). */
export const MAX_RISER = 0.18;
/** Ideal step rule 2h + b (m); the tread starts at STEP_TARGET − 2h. */
export const STEP_TARGET = 0.62;
/** Smallest allowed 2h + b (m); the tread may shrink to STEP_MIN − 2h to fit the bay. */
export const STEP_MIN = 0.6;
/** Winder treads per 90° turn. */
export const WINDERS_PER_QUARTER = 3;
/** Spiral stair centre column diameter (m). */
export const SPIRAL_COLUMN_DIAMETER = 0.15;
/** Minimum rise of one full spiral turn (m) for headroom. */
export const SPIRAL_MIN_TURN_RISE = 2.1;
/**
 * How far (m) flightWidth may exceed the bay width (half of it for U) and still be accepted: XML
 * rounds to 4 decimals, so a flight saved at full width may come back up to 5e-5 wider. Within
 * this tolerance the layout treats the flight as exactly full width.
 */
export const FLIGHT_WIDTH_TOL = 1e-4;
