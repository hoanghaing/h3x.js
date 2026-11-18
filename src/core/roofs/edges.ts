import { XML_DECIMALS } from '../constants';
import type { RoofEdge } from '../types';

const tidy = (n: number): string => Number(n.toFixed(XML_DECIMALS)).toString();

function number(s: string, what: string, spec: string): number {
  const n = s.trim() === '' ? NaN : Number(s);
  if (!Number.isFinite(n)) throw new Error(`Roof edge "${spec}": ${what} is not a number`);
  return n;
}

/**
 * Parses an edge spec: `gable`, `slope:<pitch>` or `slope:<pitch>/<breakHeight>/<upperPitch>`.
 * Throws an `Error` on any other text, a non-finite number, a pitch outside (0, 90) or a
 * non-positive break height.
 */
export function parseRoofEdge(s: string): RoofEdge {
  const spec = s.trim();
  if (spec === 'gable') return { kind: 'gable' };
  if (!spec.startsWith('slope:')) throw new Error(`Roof edge "${spec}" is not gable or slope:...`);
  const parts = spec.slice('slope:'.length).split('/');
  if (parts.length !== 1 && parts.length !== 3) {
    throw new Error(
      `Roof edge "${spec}" must be slope:<p> or slope:<p>/<breakHeight>/<upperPitch>`,
    );
  }
  const pitch = number(parts[0]!, 'pitch', spec);
  if (!(pitch > 0 && pitch < 90)) throw new Error(`Roof edge "${spec}": pitch must be in (0, 90)`);
  if (parts.length === 1) return { kind: 'slope', pitch };
  const breakHeight = number(parts[1]!, 'break height', spec);
  const upperPitch = number(parts[2]!, 'upper pitch', spec);
  if (!(breakHeight > 0)) throw new Error(`Roof edge "${spec}": break height must be > 0`);
  if (!(upperPitch > 0 && upperPitch < 90)) {
    throw new Error(`Roof edge "${spec}": upper pitch must be in (0, 90)`);
  }
  return { kind: 'slope', pitch, breakHeight, upperPitch };
}

/** Inverse of `parseRoofEdge` (numbers rounded to the XML precision). */
export function formatRoofEdge(e: RoofEdge): string {
  if (e.kind === 'gable') return 'gable';
  if (e.breakHeight !== undefined && e.upperPitch !== undefined) {
    return `slope:${tidy(e.pitch)}/${tidy(e.breakHeight)}/${tidy(e.upperPitch)}`;
  }
  return `slope:${tidy(e.pitch)}`;
}
