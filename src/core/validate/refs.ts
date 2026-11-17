import type { Floor, Id } from '../types';

export interface BadRef {
  /** Entity holding the dangling reference. */
  id: Id;
  element: 'wall' | 'opening' | 'room' | 'item';
  attribute: string;
  /** Referenced id that does not exist. */
  target: Id;
  table: 'nodes' | 'walls';
  message: string;
}

/**
 * Dangling references in a floor: walls to nodes, openings / wall items / rooms
 * to walls. Shared by the XML parser and H3xDocument.fromProject.
 */
export function checkRefs(floor: Floor): BadRef[] {
  const out: BadRef[] = [];
  const check = (
    id: Id,
    element: BadRef['element'],
    attribute: string,
    table: BadRef['table'],
    target: Id,
  ): void => {
    if (floor[table][target]) return;
    out.push({
      id,
      element,
      attribute,
      target,
      table,
      message: `<${element}> "${id}" attribute "${attribute}" references missing ${table.slice(0, -1)} "${target}"`,
    });
  };
  for (const w of Object.values(floor.walls)) {
    check(w.id, 'wall', 'a', 'nodes', w.a);
    check(w.id, 'wall', 'b', 'nodes', w.b);
  }
  for (const o of Object.values(floor.openings)) check(o.id, 'opening', 'wall', 'walls', o.wall);
  for (const r of Object.values(floor.rooms)) {
    for (const wid of r.walls) check(r.id, 'room', 'walls', 'walls', wid);
    for (const hole of r.holes ?? []) {
      for (const wid of hole) check(r.id, 'room', 'holes', 'walls', wid);
    }
  }
  for (const i of Object.values(floor.items)) {
    if (i.mount === 'wall') check(i.id, 'item', 'wall', 'walls', i.wall);
  }
  return out;
}
