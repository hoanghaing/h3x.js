import { DEFAULT_SLAB_THICKNESS, FORMAT_VERSION } from '../constants';
import { H3xParseError, H3xVersionError } from '../errors';
import { createId } from '../ids';
import { detectRooms } from '../rooms/detect';
import { normalizeRoomOrientation } from '../rooms/normalize';
import { checkRefs } from '../validate/refs';
import { validateStairParams } from '../commands/stairs';
import { validateRoofParams } from '../commands/roofs';
import { normalizeOpening, type RawOpening } from '../openings/normalize';
import { validateOpeningParams } from '../openings/params';
import { parseRoofEdge } from '../roofs/edges';
import { signedArea } from '../geometry/polygon';
import type {
  Column,
  Stair,
  Floor,
  Id,
  Hinge,
  Item,
  OpeningType,
  PlanNode,
  Project,
  Roof,
  RoofEdge,
  RoofMaterial,
  Room,
  Site,
  Swing,
  Vec2,
  Wall,
} from '../types';

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

function parseColumn(e: Element): Column {
  const shape = req(e, 'shape');
  if (shape !== 'round' && shape !== 'square') {
    throw new H3xParseError(`<column> attribute "shape" must be round or square: "${shape}"`, {
      element: 'column',
      attribute: 'shape',
    });
  }
  const c: Column = {
    id: req(e, 'id'),
    x: num(e, 'x'),
    y: num(e, 'y'),
    shape,
    width: num(e, 'width'),
    rotation: num(e, 'rotation', 0),
  };
  if (e.getAttribute('depth') !== null) c.depth = num(e, 'depth');
  if (e.getAttribute('height') !== null) c.height = num(e, 'height');
  return c;
}

function parseStair(e: Element): Stair {
  const bad = (attribute: string, message: string): H3xParseError =>
    new H3xParseError(`<stair> attribute "${attribute}" ${message}`, {
      element: 'stair',
      attribute,
    });
  const type = req(e, 'type');
  if (type !== 'straight' && type !== 'L' && type !== 'U' && type !== 'spiral') {
    throw bad('type', `must be straight, L, U or spiral: "${type}"`);
  }
  const turn = opt(e, 'turn') ?? 'landing';
  if (turn !== 'landing' && turn !== 'winder') {
    throw bad('turn', `must be landing or winder: "${turn}"`);
  }
  const hand = opt(e, 'hand') ?? 'right';
  if (hand !== 'left' && hand !== 'right') {
    throw bad('hand', `must be left or right: "${hand}"`);
  }
  const s: Stair = {
    id: req(e, 'id'),
    x: num(e, 'x'),
    y: num(e, 'y'),
    width: num(e, 'width'),
    depth: num(e, 'depth'),
    rotation: num(e, 'rotation', 0),
    type,
    turn,
    hand,
    flightWidth: num(e, 'flightWidth', 0.9),
  };
  for (const k of ['width', 'depth', 'flightWidth'] as const) {
    if (s[k] <= 0) throw bad(k, `must be positive: "${s[k]}"`);
  }
  const issue = validateStairParams(s)[0];
  if (issue)
    throw new H3xParseError(`<stair id="${s.id}">: ${issue.message}`, { element: 'stair' });
  return s;
}

function parseRoof(e: Element): Roof {
  const bad = (attribute: string, message: string): H3xParseError =>
    new H3xParseError(`<roof> attribute "${attribute}" ${message}`, {
      element: 'roof',
      attribute,
    });
  const points = (attribute: string, raw: string): Vec2[] =>
    raw
      .split(/\s+/)
      .filter(Boolean)
      .map((pair) => {
        const parts = pair.split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (
          parts.length !== 2 ||
          parts.some((s) => s.trim() === '') ||
          !Number.isFinite(x) ||
          !Number.isFinite(y)
        ) {
          throw bad(attribute, `has a point that is not "x,y" with finite numbers: "${pair}"`);
        }
        return { x, y };
      });
  const edges = (attribute: string, raw: string): RoofEdge[] =>
    raw
      .split(/\s+/)
      .filter(Boolean)
      .map((spec) => {
        try {
          return parseRoofEdge(spec);
        } catch (err) {
          throw bad(attribute, `is malformed: ${(err as Error).message}`);
        }
      });
  const followRaw = opt(e, 'follow') ?? '1';
  if (!['0', '1', 'true', 'false'].includes(followRaw)) {
    throw bad('follow', `must be 0, 1, true or false: "${followRaw}"`);
  }
  const follow = followRaw === '1' || followRaw === 'true';
  const r: Roof = {
    id: req(e, 'id'),
    kind: (opt(e, 'kind') ?? 'pitched') as Roof['kind'],
    follow,
    pitch: num(e, 'pitch', 30),
    base: num(e, 'base', 0),
    overhang: num(e, 'overhang', 0.5),
    gableOverhang: num(e, 'gableOverhang', 0.3),
    thickness: num(e, 'thickness', 0.1),
    material: (opt(e, 'material') ?? 'tile') as RoofMaterial,
  };
  if (r.kind !== 'pitched' && r.kind !== 'flat') {
    throw bad('kind', `must be pitched or flat: "${r.kind}"`);
  }
  const preset = opt(e, 'preset');
  if (preset !== undefined) r.preset = preset;
  if (follow) {
    r.rooms = (opt(e, 'rooms') ?? '').split(/\s+/).filter(Boolean);
    const raw = opt(e, 'wallEdges');
    if (raw !== undefined) {
      const wallEdges: Record<Id, RoofEdge> = {};
      for (const item of raw.split(/\s+/).filter(Boolean)) {
        const i = item.indexOf(':');
        if (i <= 0) throw bad('wallEdges', `entry is not "wall:spec": "${item}"`);
        wallEdges[item.slice(0, i)] = edges('wallEdges', item.slice(i + 1))[0]!;
      }
      if (Object.keys(wallEdges).length > 0) r.wallEdges = wallEdges;
    }
  } else {
    r.points = points('points', opt(e, 'points') ?? '');
    const holes = opt(e, 'holes');
    if (holes !== undefined) {
      r.holes = holes
        .split(';')
        .filter((h) => h.trim() !== '')
        .map((h) => points('holes', h));
    }
    const es = opt(e, 'edges');
    if (es !== undefined) r.edges = edges('edges', es);
    const hes = opt(e, 'holeEdges');
    if (hes !== undefined) {
      r.holeEdges = hes
        .split(';')
        .filter((h) => h.trim() !== '')
        .map((h) => edges('holeEdges', h));
    }
  }
  for (const k of ['breakHeight', 'upperPitch', 'parapet', 'postSize', 'postSpacing'] as const) {
    if (e.getAttribute(k) !== null) r[k] = num(e, k);
  }
  if (r.breakHeight !== undefined && r.upperPitch === undefined) {
    throw bad('breakHeight', 'needs upperPitch (a break takes both)');
  }
  if (r.upperPitch !== undefined && r.breakHeight === undefined) {
    throw bad('upperPitch', 'needs breakHeight (a break takes both)');
  }
  const supports = opt(e, 'supports');
  if (supports !== undefined) r.supports = supports as 'posts';
  const issue = validateRoofParams(r)[0];
  if (issue) throw new H3xParseError(`<roof id="${r.id}">: ${issue.message}`, { element: 'roof' });
  return r;
}

function parseSite(e: Element): Site {
  const bad = (message: string): H3xParseError =>
    new H3xParseError(message, { element: 'site', attribute: 'points' });
  const points: Vec2[] = req(e, 'points')
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const parts = pair.split(',');
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (
        parts.length !== 2 ||
        parts.some((s) => s.trim() === '') ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        throw bad(`<site> point is not "x,y" with finite numbers: "${pair}"`);
      }
      return { x, y };
    });
  if (points.length < 3) throw bad('<site> needs at least 3 points');
  // CW input is reversed to CCW, keeping the first point first.
  const ccw = signedArea(points) < 0 ? [points[0]!, ...points.slice(1).reverse()] : points;
  return { id: 'site', points: ccw };
}

function parseFloor(fe: Element): Floor {
  const floor: Floor = {
    id: req(fe, 'id'),
    level: num(fe, 'level', 0),
    elevation: num(fe, 'elevation', 0),
    wallHeight: num(fe, 'wallHeight'),
    slabThickness: num(fe, 'slabThickness', DEFAULT_SLAB_THICKNESS),
    nodes: {},
    walls: {},
    openings: {},
    rooms: {},
    items: {},
    columns: {},
    stairs: {},
    roofs: {},
  };
  if (floor.slabThickness <= 0) {
    throw new H3xParseError(
      `<floor> attribute "slabThickness" must be positive: "${floor.slabThickness}"`,
      {
        element: 'floor',
        attribute: 'slabThickness',
      },
    );
  }
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
        const raw: RawOpening = {
          id: req(e, 'id'),
          wall: req(e, 'wall'),
          preset: req(e, 'preset'),
          offset: num(e, 'offset'),
          width: num(e, 'width'),
          height: num(e, 'height'),
          sill: num(e, 'sill', 0),
          flip: flip === '1' || flip === 'true',
        };
        // The new attributes are cast; validateOpeningParams below rejects a bad value.
        const type = opt(e, 'type');
        const hinge = opt(e, 'hinge');
        const swing = opt(e, 'swing');
        if (type !== undefined) raw.type = type as OpeningType;
        if (hinge !== undefined) raw.hinge = hinge as Hinge;
        if (swing !== undefined) raw.swing = swing as Swing;
        if (e.hasAttribute('leaves')) raw.leaves = num(e, 'leaves');
        if (e.hasAttribute('split')) raw.split = num(e, 'split');
        const o = normalizeOpening(raw);
        if (!(o.width > 0)) {
          throw new H3xParseError(`<opening> attribute "width" must be above 0: "${o.width}"`, {
            element: 'opening',
            attribute: 'width',
          });
        }
        const [bad] = validateOpeningParams(o);
        if (bad) throw new H3xParseError(bad.message, { element: 'opening' });
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
        const rawHoles = opt(e, 'holes');
        if (rawHoles !== undefined) {
          const holes = rawHoles
            .split(';')
            .map((h) => h.split(/\s+/).filter(Boolean))
            .filter((h) => h.length > 0);
          if (holes.length > 0) r.holes = holes;
        }
        add(floor.rooms, r, 'room');
        break;
      }
      case 'item':
        add(floor.items, parseItem(e), 'item');
        break;
      case 'column':
        add(floor.columns, parseColumn(e), 'column');
        break;
      case 'stair':
        add(floor.stairs, parseStair(e), 'stair');
        break;
      case 'roof':
        add(floor.roofs, parseRoof(e), 'roof');
        break;
      default:
        break; // unknown elements are ignored
    }
    // locked="true" on any lockable element.
    if (e.getAttribute('locked') === 'true') {
      const coll = (
        {
          wall: floor.walls,
          opening: floor.openings,
          item: floor.items,
          column: floor.columns,
          stair: floor.stairs,
          roof: floor.roofs,
        } as Record<string, Record<string, { locked?: boolean }>>
      )[e.tagName];
      const ent = coll?.[e.getAttribute('id') ?? ''];
      if (ent) ent.locked = true;
    }
  }

  const bad = checkRefs(floor)[0];
  if (bad) throw new H3xParseError(bad.message, { element: bad.element, attribute: bad.attribute });
  if (Object.keys(floor.rooms).length === 0) {
    for (const d of detectRooms(floor)) {
      const id = createId();
      floor.rooms[id] = {
        id,
        walls: d.walls,
        name: '',
        ...(d.holes.length ? { holes: d.holes } : {}),
      };
    }
  } else {
    normalizeRoomOrientation(floor, (room, err, attribute) => {
      throw new H3xParseError(`room "${room.id}" ${attribute} do not form a loop: ${err.message}`, {
        element: 'room',
        attribute,
      });
    });
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

  const floorEls = children(root, 'floor');
  if (floorEls.length === 0) {
    throw new H3xParseError('<h3x> has no floor', { element: 'h3x' });
  }
  const metaEl = children(root, 'meta')[0];
  const siteEls = children(root, 'site');
  if (siteEls.length > 1) {
    throw new H3xParseError('<h3x> has more than one <site>', { element: 'site' });
  }
  const floors = floorEls.map(parseFloor);
  const floorIds = new Set<Id>();
  for (const f of floors) {
    if (floorIds.has(f.id)) {
      throw new H3xParseError(`duplicate floor id "${f.id}"`, {
        element: 'floor',
        attribute: 'id',
      });
    }
    floorIds.add(f.id);
  }
  const site = siteEls[0] ? parseSite(siteEls[0]) : undefined;
  return {
    version,
    unit: 'm',
    meta: {
      name: metaEl?.getAttribute('name') ?? '',
      created: metaEl?.getAttribute('created') ?? '',
    },
    floors,
    ...(site ? { site } : {}),
  };
}
