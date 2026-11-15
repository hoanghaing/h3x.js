import { FORMAT_VERSION } from '../constants';
import { H3xParseError, H3xValidationError, H3xVersionError } from '../errors';
import { signedArea } from '../geometry/polygon';
import { createId } from '../ids';
import { detectRooms, roomPolygon } from '../rooms/detect';
import type { Floor, Id, Item, Opening, PlanNode, Project, Room, Wall } from '../types';

function req(e: Element, attr: string): string {
  const v = e.getAttribute(attr);
  if (v === null) {
    throw new H3xParseError(`<${e.localName}> is missing attribute "${attr}"`, {
      element: e.localName,
      attribute: attr,
    });
  }
  return v;
}

function num(e: Element, attr: string, fallback?: number): number {
  const raw = e.getAttribute(attr);
  if (raw === null) {
    if (fallback !== undefined) return fallback;
    return Number(req(e, attr));
  }
  const s = raw.trim();
  const n = Number(s);
  if (s === '' || !Number.isFinite(n)) {
    throw new H3xParseError(`<${e.localName}> attribute "${attr}" is not a number: "${raw}"`, {
      element: e.localName,
      attribute: attr,
    });
  }
  return n;
}

const opt = (e: Element, attr: string): string | undefined => e.getAttribute(attr) ?? undefined;

function children(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((c) => c.localName === name);
}

function parseItem(e: Element): Item {
  const base = { id: req(e, 'id'), preset: req(e, 'preset') };
  const variant = opt(e, 'variant');
  const withVariant = variant === undefined ? base : { ...base, variant };
  const mount = req(e, 'mount');
  switch (mount) {
    case 'floor':
    case 'ceiling':
      return {
        ...withVariant,
        mount,
        x: num(e, 'x'),
        y: num(e, 'y'),
        rotation: num(e, 'rotation', 0),
      };
    case 'wall': {
      const side = req(e, 'side');
      if (side !== 'left' && side !== 'right') {
        throw new H3xParseError(`<item> attribute "side" must be left or right: "${side}"`, {
          element: 'item',
          attribute: 'side',
        });
      }
      return {
        ...withVariant,
        mount,
        wall: req(e, 'wall'),
        side,
        offset: num(e, 'offset'),
        elevation: num(e, 'elevation', 0),
      };
    }
    default:
      throw new H3xParseError(`<item> has unsupported mount "${mount}"`, {
        element: 'item',
        attribute: 'mount',
      });
  }
}

function missingRef(
  floor: Floor,
  table: 'nodes' | 'walls',
  id: Id,
  element: string,
  attribute: string,
): void {
  if (!floor[table][id]) {
    throw new H3xParseError(
      `<${element}> attribute "${attribute}" references missing ${table.slice(0, -1)} "${id}"`,
      { element, attribute },
    );
  }
}

function checkRefs(floor: Floor): void {
  for (const w of Object.values(floor.walls)) {
    missingRef(floor, 'nodes', w.a, 'wall', 'a');
    missingRef(floor, 'nodes', w.b, 'wall', 'b');
  }
  for (const o of Object.values(floor.openings)) {
    missingRef(floor, 'walls', o.wall, 'opening', 'wall');
  }
  for (const r of Object.values(floor.rooms)) {
    for (const id of r.walls) missingRef(floor, 'walls', id, 'room', 'walls');
  }
  for (const i of Object.values(floor.items)) {
    if (i.mount === 'wall') missingRef(floor, 'walls', i.wall, 'item', 'wall');
  }
}

/** Ruling R2: rooms are stored CCW. */
function normalizeRoom(floor: Floor, room: Room): void {
  try {
    if (signedArea(roomPolygon(floor, room, 'center')) < 0) room.walls.reverse();
  } catch (err) {
    if (err instanceof H3xValidationError) {
      throw new H3xParseError(`room "${room.id}" walls do not form a loop: ${err.message}`, {
        element: 'room',
        attribute: 'walls',
      });
    }
    throw err;
  }
}

function parseFloor(fe: Element): Floor {
  const floor: Floor = {
    id: req(fe, 'id'),
    level: num(fe, 'level', 0),
    elevation: num(fe, 'elevation', 0),
    wallHeight: num(fe, 'wallHeight'),
    nodes: {},
    walls: {},
    openings: {},
    rooms: {},
    items: {},
  };
  const seen = new Set<Id>();
  const add = <T extends { id: Id }>(rec: Record<Id, T>, ent: T, element: string): void => {
    if (seen.has(ent.id)) {
      throw new H3xParseError(`duplicate id "${ent.id}" in floor ${floor.id}`, {
        element,
        attribute: 'id',
      });
    }
    seen.add(ent.id);
    rec[ent.id] = ent;
  };

  for (const e of Array.from(fe.children)) {
    switch (e.localName) {
      case 'node': {
        const n: PlanNode = { id: req(e, 'id'), x: num(e, 'x'), y: num(e, 'y') };
        add(floor.nodes, n, 'node');
        break;
      }
      case 'wall': {
        const w: Wall = {
          id: req(e, 'id'),
          a: req(e, 'a'),
          b: req(e, 'b'),
          thickness: num(e, 'thickness'),
          height: num(e, 'height', floor.wallHeight),
        };
        const fl = opt(e, 'finishLeft');
        const fr = opt(e, 'finishRight');
        if (fl !== undefined) w.finishLeft = fl;
        if (fr !== undefined) w.finishRight = fr;
        add(floor.walls, w, 'wall');
        break;
      }
      case 'opening': {
        const flip = e.getAttribute('flip');
        const o: Opening = {
          id: req(e, 'id'),
          wall: req(e, 'wall'),
          preset: req(e, 'preset'),
          offset: num(e, 'offset'),
          width: num(e, 'width'),
          height: num(e, 'height'),
          sill: num(e, 'sill', 0),
          flip: flip === '1' || flip === 'true',
        };
        add(floor.openings, o, 'opening');
        break;
      }
      case 'room': {
        const r: Room = {
          id: req(e, 'id'),
          walls: req(e, 'walls').split(/\s+/).filter(Boolean),
          name: e.getAttribute('name') ?? '',
        };
        const ff = opt(e, 'floorFinish');
        if (ff !== undefined) r.floorFinish = ff;
        add(floor.rooms, r, 'room');
        break;
      }
      case 'item':
        add(floor.items, parseItem(e), 'item');
        break;
      default:
        break; // unknown elements are ignored
    }
  }

  checkRefs(floor);
  if (Object.keys(floor.rooms).length === 0) {
    for (const d of detectRooms(floor)) {
      const id = createId();
      floor.rooms[id] = { id, walls: d.walls, name: '' };
    }
  } else {
    for (const room of Object.values(floor.rooms)) normalizeRoom(floor, room);
  }
  return floor;
}

export function projectFromXML(xml: string): Project {
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const perr = dom.getElementsByTagName('parsererror')[0];
  if (perr) {
    throw new H3xParseError(`Malformed XML: ${(perr.textContent ?? '').trim().slice(0, 200)}`);
  }
  const root = dom.documentElement;
  if (root.localName !== 'h3x') {
    throw new H3xParseError(`Root element must be <h3x>, found <${root.localName}>`, {
      element: root.localName,
    });
  }
  const rawVersion = root.getAttribute('version');
  if (rawVersion === null) {
    throw new H3xParseError('<h3x> is missing attribute "version"', {
      element: 'h3x',
      attribute: 'version',
    });
  }
  const version = Number(rawVersion);
  if (!Number.isInteger(version) || version < 1) {
    throw new H3xParseError(`<h3x> version is not a valid integer: "${rawVersion}"`, {
      element: 'h3x',
      attribute: 'version',
    });
  }
  if (version > FORMAT_VERSION) throw new H3xVersionError(version);

  const unit = root.getAttribute('unit');
  if (unit !== null && unit !== 'm') {
    throw new H3xParseError(`<h3x> unit must be "m": "${unit}"`, {
      element: 'h3x',
      attribute: 'unit',
    });
  }

  const metaEl = children(root, 'meta')[0];
  return {
    version,
    unit: 'm',
    meta: {
      name: metaEl?.getAttribute('name') ?? '',
      created: metaEl?.getAttribute('created') ?? '',
    },
    floors: children(root, 'floor').map(parseFloor),
  };
}
