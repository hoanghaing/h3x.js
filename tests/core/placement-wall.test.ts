import { describe, expect, it } from 'vitest';
import { resolvePlacement } from '../../src/core/placement';
import type { PlacementRequest } from '../../src/core/placement';
import { detectRooms } from '../../src/core/rooms/detect';
import { pointInPolygon } from '../../src/core/geometry/polygon';
import type { Floor, Hinge, Opening, PlanNode, Swing, Vec2, Wall } from '../../src/core/types';
import { holedRoomFloor, twoRoomFloor } from '../fixtures/floors';

const W = 0.9;

function emptyFloor(): Floor {
  return {
    id: 'f',
    level: 0,
    elevation: 0,
    wallHeight: 3.2,
    slabThickness: 0.15,
    nodes: {},
    walls: {},
    openings: {},
    rooms: {},
    items: {},
    columns: {},
    stairs: {},
    roofs: {},
  };
}

/** Free-standing walls, each [id, from, to]; 0.2 thick. */
function wallsFloor(walls: [string, Vec2, Vec2][]): Floor {
  const f = emptyFloor();
  for (const [id, a, b] of walls) {
    f.nodes[`${id}a`] = { id: `${id}a`, ...a };
    f.nodes[`${id}b`] = { id: `${id}b`, ...b };
    f.walls[id] = { id, a: `${id}a`, b: `${id}b`, thickness: 0.2, height: 3.2 };
  }
  return f;
}

/** A closed ring of walls w1..wn (w_i from point i to point i+1); rooms from detectRooms. */
function ringFloor(pts: Vec2[], flip: (i: number) => boolean = () => false): Floor {
  const f = emptyFloor();
  pts.forEach((p, i) => (f.nodes[`n${i}`] = { id: `n${i}`, ...p }));
  pts.forEach((_, i) => {
    const a = `n${i}`;
    const b = `n${(i + 1) % pts.length}`;
    const id = `w${i + 1}`;
    f.walls[id] = { id, a: flip(i) ? b : a, b: flip(i) ? a : b, thickness: 0.2, height: 3.2 };
  });
  detectRooms(f).forEach((d, i) => {
    f.rooms[`r${i + 1}`] = {
      id: `r${i + 1}`,
      walls: d.walls,
      name: `Room ${i + 1}`,
      holes: d.holes,
    };
  });
  return f;
}

const subject = (over: Partial<Opening> = {}): PlacementRequest['subject'] => ({
  mount: 'opening',
  opening: {
    preset: 'p',
    width: W,
    height: 2.1,
    sill: 0,
    type: 'door-swing',
    hinge: 'a',
    swing: 'left',
    ...over,
  },
});

const req = (point: Vec2, over: Partial<PlacementRequest> = {}): PlacementRequest => ({
  subject: subject(),
  point,
  reach: 0.3,
  snapReach: 0.2,
  grid: 0.05,
  free: false,
  ...over,
});

const door = (id: string, wall: string, offset: number, width: number): Opening => ({
  id,
  wall,
  preset: 'p',
  offset,
  width,
  height: 2.1,
  sill: 0,
  type: 'door-swing',
  hinge: 'a',
  swing: 'left',
});

/** A 10 m wall along x with one opening o1, 1 m wide, centred at 7.5. */
function snapFloor(): Floor {
  const f = wallsFloor([['w', { x: 0, y: 0 }, { x: 10, y: 0 }]]);
  f.openings.o1 = door('o1', 'w', 7.5, 1);
  return f;
}

const at = (f: Floor, x: number, over: Partial<PlacementRequest> = {}) =>
  resolvePlacement(f, req({ x, y: 0.05 }, over))!;
const kinds = (p: { guides: { kind: string }[] }): string[] => p.guides.map((g) => g.kind);
const codes = (p: { issues: { code: string }[] }): string[] => p.issues.map((i) => i.code);

describe('placement on a wall: snaps', () => {
  it('snaps to the ends of the usable range', () => {
    const f = snapFloor();
    expect(at(f, 0.62).offset).toBeCloseTo(0.55, 9);
    expect(kinds(at(f, 0.62))).toEqual(['end']);
    expect(at(f, 9.35).offset).toBeCloseTo(9.45, 9);
    expect(kinds(at(f, 9.35))).toEqual(['end']);
  });

  it('snaps to the middle of the wall', () => {
    const p = at(snapFloor(), 5.12);
    expect(p.offset).toBeCloseTo(5, 9);
    expect(kinds(p)).toEqual(['middle']);
  });

  it('snaps to the jambs of another opening on the wall', () => {
    const left = at(snapFloor(), 6.45);
    expect(left.offset).toBeCloseTo(6.55, 9);
    expect(kinds(left)).toEqual(['opening']);
    expect(left.issues).toEqual([]);
    const right = at(snapFloor(), 8.5);
    expect(right.offset).toBeCloseTo(8.45, 9);
    expect(kinds(right)).toEqual(['opening']);
  });

  it('does not stick at the centre of another opening on the wall', () => {
    const p = at(snapFloor(), 7.38);
    expect(p.offset).toBeCloseTo(7.4, 9);
    expect(kinds(p)).toEqual(['grid']);
    expect(codes(p)).toContain('opening-overlap');
    const bare = at(snapFloor(), 7.42, { grid: 0 });
    expect(bare.offset).toBeCloseTo(7.42, 9);
    expect(bare.guides).toEqual([]);
  });

  it('snaps to the middle of the free gap', () => {
    // Gap from the face limit 0.1 to the jamb at 7: middle 3.55.
    const p = at(snapFloor(), 3.45);
    expect(p.offset).toBeCloseTo(3.55, 9);
    expect(kinds(p)).toEqual(['gap']);
  });

  it('snaps the centre to the grid', () => {
    const p = at(snapFloor(), 2.02);
    expect(p.offset).toBeCloseTo(2, 9);
    expect(kinds(p)).toEqual(['grid']);
    expect(at(snapFloor(), 1.234, { grid: 0.1 }).offset).toBeCloseTo(1.2, 9);
  });

  it('draws each guide across the wall at the snapped place', () => {
    const p = at(snapFloor(), 5.12);
    expect(p.guides[0]!.from.x).toBeCloseTo(5, 9);
    expect(p.guides[0]!.to.x).toBeCloseTo(5, 9);
    expect(Math.abs(p.guides[0]!.from.y - p.guides[0]!.to.y)).toBeCloseTo(0.2, 9);
    const end = at(snapFloor(), 0.62);
    // The jamb sits on the limit at 0.1.
    expect(end.guides[0]!.from.x).toBeCloseTo(0.1, 9);
  });

  it('a range end wins over the wall middle', () => {
    const f = wallsFloor([['w', { x: 0, y: 0 }, { x: 1.5, y: 0 }]]);
    // lo 0.55, hi 0.95, middle 0.75.
    const p = at(f, 0.7);
    expect(p.offset).toBeCloseTo(0.55, 9);
    expect(kinds(p)).toEqual(['end']);
  });

  it('the wall middle wins over an opening jamb', () => {
    const f = wallsFloor([['w', { x: 0, y: 0 }, { x: 10, y: 0 }]]);
    f.openings.o1 = door('o1', 'w', 6, 0.2);
    // Jamb snap at 5.45, middle at 5.
    const p = at(f, 5.3, { snapReach: 0.5 });
    expect(p.offset).toBeCloseTo(5, 9);
    expect(kinds(p)).toEqual(['middle']);
  });

  it('an opening jamb wins over the middle of the gap', () => {
    const f = wallsFloor([['w', { x: 0, y: 0 }, { x: 10, y: 0 }]]);
    f.openings.o1 = door('o1', 'w', 1, 0.6);
    f.openings.o2 = door('o2', 'w', 2.75, 0.5);
    // Gap 1.3 .. 2.5, middle 1.9; jamb snaps 1.75 and 2.05.
    const p = at(f, 1.88);
    expect(p.offset).toBeCloseTo(1.75, 9);
    expect(kinds(p)).toEqual(['opening']);
  });

  it('the middle of the gap wins over the grid', () => {
    const p = at(snapFloor(), 3.42);
    expect(p.offset).toBeCloseTo(3.55, 9);
    expect(kinds(p)).toEqual(['gap']);
  });

  it('free disables every snap', () => {
    for (const x of [0.62, 5.12, 6.45, 7.38, 3.45, 2.02]) {
      const p = at(snapFloor(), x, { free: true });
      expect(p.offset).toBeCloseTo(x, 9);
      expect(p.guides).toEqual([]);
    }
  });

  it('free still keeps the offset in the usable range', () => {
    const f = snapFloor();
    expect(resolvePlacement(f, req({ x: -0.05, y: 0 }, { free: true }))!.offset).toBeCloseTo(
      0.55,
      9,
    );
    expect(resolvePlacement(f, req({ x: 10.05, y: 0 }, { free: true }))!.offset).toBeCloseTo(
      9.45,
      9,
    );
  });

  it('a drag keeps the grab between the pointer and the centre', () => {
    const f = snapFloor();
    const p = at(f, 3.3, { free: true, from: { wall: 'w', grab: 0.3 } });
    expect(p.offset).toBeCloseTo(3, 9);
  });
});

describe('placement on a wall: other openings', () => {
  it('passing over another opening gives issues and is not pushed away', () => {
    const p = at(snapFloor(), 7.2, { free: true });
    expect(p.offset).toBeCloseTo(7.2, 9);
    expect(codes(p)).toEqual(['opening-overlap']);
    expect(p.issues[0]!.ids).toContain('o1');
  });

  it('beyond the other opening it is valid again', () => {
    const p = at(snapFloor(), 8.9, { free: true });
    expect(p.offset).toBeCloseTo(8.9, 9);
    expect(p.issues).toEqual([]);
  });

  it('the opening being moved does not overlap itself', () => {
    const f = snapFloor();
    const p = at(f, 7.6, {
      free: true,
      subject: { mount: 'opening', opening: { ...f.openings.o1!, id: 'o1' } },
      from: { wall: 'w', grab: 0 },
    });
    expect(p.offset).toBeCloseTo(7.6, 9);
    expect(p.issues).toEqual([]);
  });

  it('a wall shorter than the opening gives opening-out-of-wall, never NaN', () => {
    const f = wallsFloor([['w', { x: 0, y: 0 }, { x: 0.6, y: 0 }]]);
    for (const free of [false, true]) {
      const p = at(f, 0.3, { free });
      expect(p.wall).toBe('w');
      expect(Number.isFinite(p.offset)).toBe(true);
      expect(codes(p)).toContain('opening-out-of-wall');
      for (const g of p.guides) {
        expect(Number.isFinite(g.from.x + g.from.y + g.to.x + g.to.y)).toBe(true);
      }
    }
  });
});

describe('placement on a wall: choosing the wall', () => {
  it('no wall in reach gives null', () => {
    const f = snapFloor();
    expect(resolvePlacement(f, req({ x: 5, y: 1 }, { reach: 0.5 }))).toBeNull();
    expect(resolvePlacement(f, req({ x: 5, y: 0.55 }, { reach: 0.5 }))?.wall).toBe('w');
    expect(resolvePlacement(emptyFloor(), req({ x: 0, y: 0 }))).toBeNull();
  });

  it('measures from the wall face, not its centre line', () => {
    const f = snapFloor();
    // 0.39 from the centre line is 0.29 from the face.
    expect(resolvePlacement(f, req({ x: 5, y: 0.39 }))?.wall).toBe('w');
    expect(resolvePlacement(f, req({ x: 5, y: 0.41 }))).toBeNull();
  });

  const corner = (): Floor =>
    wallsFloor([
      ['w1', { x: 0, y: 0 }, { x: 4, y: 0 }],
      ['w2', { x: 4, y: 0 }, { x: 4, y: 4 }],
    ]);

  it('keeps the current wall at a corner until another is clearly nearer', () => {
    const f = corner();
    // w1 0.15 away, w2 0.1 away, reach 0.24: hysteresis 0.06.
    const p = { x: 3.8, y: 0.25 };
    expect(resolvePlacement(f, req(p, { reach: 0.24 }))!.wall).toBe('w2');
    expect(resolvePlacement(f, req(p, { reach: 0.24, current: 'w1' }))!.wall).toBe('w1');
    expect(
      resolvePlacement(f, req({ x: 3.85, y: 0.3 }, { reach: 0.24, current: 'w1' }))!.wall,
    ).toBe('w2');
  });

  it('keeps the current wall at 5 px/m', () => {
    const f = wallsFloor([
      ['w1', { x: 0, y: 0 }, { x: 4, y: 0 }],
      ['w3', { x: 0, y: 3 }, { x: 4, y: 3 }],
    ]);
    const reach = 24 / 5;
    expect(resolvePlacement(f, req({ x: 2, y: 2 }, { reach }))!.wall).toBe('w3');
    expect(resolvePlacement(f, req({ x: 2, y: 2 }, { reach, current: 'w1' }))!.wall).toBe('w1');
    expect(resolvePlacement(f, req({ x: 2, y: 2.3 }, { reach, current: 'w1' }))!.wall).toBe('w3');
  });

  it('drops the current wall once it is out of reach', () => {
    const f = corner();
    expect(resolvePlacement(f, req({ x: 4.2, y: 2 }, { reach: 0.24, current: 'w1' }))!.wall).toBe(
      'w2',
    );
    expect(resolvePlacement(f, req({ x: 2, y: 0 }, { current: 'gone' }))!.wall).toBe('w1');
  });

  it('a known host is used as given', () => {
    const f = corner();
    expect(resolvePlacement(f, req({ x: 2, y: 0 }, { wall: 'w2' }))!.wall).toBe('w2');
    expect(resolvePlacement(f, req({ x: 2, y: 0 }, { wall: 'gone' }))).toBeNull();
  });
});

const rot = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return (p: Vec2): Vec2 => ({
    x: p.x * Math.cos(r) - p.y * Math.sin(r),
    y: p.x * Math.sin(r) + p.y * Math.cos(r),
  });
};

const ends = (f: Floor, id: string): { a: PlanNode; b: PlanNode; wall: Wall } => {
  const wall = f.walls[id]!;
  return { a: f.nodes[wall.a]!, b: f.nodes[wall.b]!, wall };
};

/** The unit normal of `id` towards `swing` (left of a -> b, or right). */
function sideNormal(f: Floor, id: string, swing: Swing): Vec2 {
  const { a, b } = ends(f, id);
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  const left = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
  return swing === 'left' ? left : { x: -left.x, y: -left.y };
}

/** Whether the `swing` side of the middle of `id` is inside the room's centre outline. */
function opensInside(f: Floor, id: string, swing: Swing, room: Vec2[]): boolean {
  const { a, b } = ends(f, id);
  const n = sideNormal(f, id, swing);
  const p = { x: (a.x + b.x) / 2 + n.x * 0.3, y: (a.y + b.y) / 2 + n.y * 0.3 };
  return pointInPolygon(p, room);
}

/** +1 or -1: which hand the hinge is on, seen from the space the opening opens into. */
function handedness(f: Floor, id: string, offset: number, hinge: Hinge, swing: Swing): number {
  const { a, b } = ends(f, id);
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  const c = { x: a.x + ((b.x - a.x) * offset) / l, y: a.y + ((b.y - a.y) * offset) / l };
  const h = hinge === 'a' ? a : b;
  const n = sideNormal(f, id, swing);
  return Math.sign((h.x - c.x) * n.y - (h.y - c.y) * n.x);
}

const middle = (f: Floor, id: string): Vec2 => {
  const { a, b } = ends(f, id);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};

const SHAPES: [string, Vec2[]][] = [
  [
    'rectangle',
    [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4 },
      { x: 0, y: 4 },
    ],
  ],
  [
    'trapezoid',
    [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 5, y: 4 },
      { x: 1, y: 4.6 },
    ],
  ],
];
const DIRECTIONS: [string, (pts: Vec2[]) => Vec2[], (i: number) => boolean][] = [
  ['counter-clockwise', (p) => p, () => false],
  ['clockwise', (p) => [...p].reverse(), () => false],
  ['mixed', (p) => p, (i) => i % 2 === 1],
];
const ORIENTATIONS: [Hinge, Swing][] = [
  ['a', 'left'],
  ['a', 'right'],
  ['b', 'left'],
  ['b', 'right'],
];

describe('placement on a wall: re-host', () => {
  for (const [shape, base] of SHAPES) {
    for (const deg of [0, 13, 30, 90]) {
      for (const [dirName, order, flip] of DIRECTIONS) {
        const pts = order(base.map(rot(deg)));
        const label = `${shape} at ${deg} degrees, ${dirName}`;

        it(`${label}: every other wall opens into the same space with the same hand`, () => {
          const f = ringFloor(pts, flip);
          expect(Object.keys(f.rooms)).toHaveLength(1);
          const ids = Object.keys(f.walls);
          for (const start of ids) {
            for (const [hinge, swing] of ORIENTATIONS) {
              const inside = opensInside(f, start, swing, pts);
              const hand = handedness(f, start, 2, hinge, swing);
              const s = subject({ hinge, swing });
              for (const target of ids) {
                const p = resolvePlacement(
                  f,
                  req(middle(f, target), {
                    subject: s,
                    from: { wall: start, grab: 0 },
                    free: true,
                  }),
                )!;
                expect(p.wall).toBe(target);
                expect(opensInside(f, target, p.swing, pts)).toBe(inside);
                expect(handedness(f, target, p.offset, p.hinge, p.swing)).toBe(hand);
              }
            }
          }
        });
      }
    }
  }

  it('a drag through another wall and back ends as a direct one', () => {
    const f = ringFloor(SHAPES[1]![1].map(rot(30)), (i) => i === 2);
    const ids = Object.keys(f.walls);
    for (const start of ids) {
      for (const [hinge, swing] of ORIENTATIONS) {
        const s = subject({ hinge, swing });
        const from = { wall: start, grab: 0 };
        for (const via of ids) {
          const there = resolvePlacement(f, req(middle(f, via), { subject: s, from, free: true }))!;
          expect(there.wall).toBe(via);
          // Back to the start, with the hop as the previous host.
          const back = resolvePlacement(
            f,
            req(middle(f, start), { subject: s, from, current: via, free: true }),
          )!;
          expect(back.wall).toBe(start);
          expect([back.hinge, back.swing]).toEqual([hinge, swing]);
          // A drag that had started on the hop, as it stood there, lands the same way.
          const hop = subject({ hinge: there.hinge, swing: there.swing });
          const again = resolvePlacement(
            f,
            req(middle(f, start), { subject: hop, from: { wall: via, grab: 0 }, free: true }),
          )!;
          expect([again.hinge, again.swing]).toEqual([hinge, swing]);
        }
      }
    }
  });

  it('from an outer wall onto a wall with rooms on both sides', () => {
    const f = twoRoomFloor();
    // w1 runs (0,0) -> (4,0), r1 on its left; w7 runs (4,0) -> (4,4), r1 left, r2 right.
    const onto = (hinge: Hinge, swing: Swing) =>
      resolvePlacement(
        f,
        req(middle(f, 'w7'), {
          subject: subject({ hinge, swing }),
          from: { wall: 'w1', grab: 0 },
          free: true,
        }),
      )!;
    // Into r1: the r1 side.
    expect([onto('a', 'left').hinge, onto('a', 'left').swing]).toEqual(['a', 'left']);
    expect([onto('b', 'left').hinge, onto('b', 'left').swing]).toEqual(['b', 'left']);
    // Outdoors faces neither side: the swing is kept (the walls are at 90 degrees).
    expect([onto('a', 'right').hinge, onto('a', 'right').swing]).toEqual(['a', 'right']);
    expect([onto('b', 'right').hinge, onto('b', 'right').swing]).toEqual(['b', 'right']);
  });

  it('from an outer wall onto a hole wall', () => {
    const f = holedRoomFloor();
    const hole = Object.keys(f.walls).filter((id) => id.startsWith('hw'));
    for (const target of hole) {
      for (const [hinge, swing] of ORIENTATIONS) {
        // w1 runs (0,0) -> (10,0): left is into the room, right is outdoors.
        const p = resolvePlacement(
          f,
          req(middle(f, target), {
            subject: subject({ hinge, swing }),
            from: { wall: 'w1', grab: 0 },
            free: true,
          }),
        )!;
        const { a, b } = ends(f, target);
        const n = sideNormal(f, target, p.swing);
        const intoHole = (5 - (a.x + b.x) / 2) * n.x + (5 - (a.y + b.y) / 2) * n.y > 0;
        expect(intoHole).toBe(swing === 'right');
        expect(handedness(f, target, p.offset, p.hinge, p.swing)).toBe(
          handedness(f, 'w1', 5, hinge, swing),
        );
      }
    }
  });

  it('a door on a shared wall keeps opening into the room it opened into', () => {
    const f = twoRoomFloor();
    // w7 runs n2 (4,0) -> n5 (4,4): its left is room r1 (x < 4), its right r2.
    const r1 = [0, 4, 4, 0].map((x, i) => ({ x, y: [0, 0, 4, 4][i]! }));
    const r2 = [4, 8, 8, 4].map((x, i) => ({ x, y: [0, 0, 4, 4][i]! }));
    for (const [swing, room, walls] of [
      ['left', r1, ['w1', 'w5', 'w6']],
      ['right', r2, ['w2', 'w3', 'w4']],
    ] as const) {
      for (const target of walls) {
        const p = resolvePlacement(
          f,
          req(middle(f, target), {
            subject: subject({ swing }),
            from: { wall: 'w7', grab: 0 },
            free: true,
          }),
        )!;
        expect(opensInside(f, target, p.swing, room)).toBe(true);
      }
    }
  });

  it('a door on a hole wall opens into the room around the hole', () => {
    const f = holedRoomFloor();
    const outer = ['w1', 'w2', 'w3', 'w4'];
    const hole = Object.keys(f.walls).filter((id) => id.startsWith('hw'));
    const room = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    for (const start of hole) {
      for (const swing of ['left', 'right'] as const) {
        const { a, b } = ends(f, start);
        const n = sideNormal(f, start, swing);
        // Into the hole is towards its centre (5, 5).
        const intoHole = (5 - (a.x + b.x) / 2) * n.x + (5 - (a.y + b.y) / 2) * n.y > 0;
        for (const target of outer) {
          const p = resolvePlacement(
            f,
            req(middle(f, target), {
              subject: subject({ swing }),
              from: { wall: start, grab: 0 },
              free: true,
            }),
          )!;
          // The hole is not a room: like outdoors.
          expect(opensInside(f, target, p.swing, room)).toBe(!intoHole);
        }
      }
    }
  });

  it('unrelated walls at 90 degrees do not flip on float noise', () => {
    for (const deg of [0, 13, 30, 45, 90, 137]) {
      const r = rot(deg);
      for (const sign of [1, -1]) {
        const f = wallsFloor([
          ['s', r({ x: 0, y: 0 }), r({ x: 3, y: 0 })],
          ['t', r({ x: 6, y: -1.5 * sign }), r({ x: 6, y: 1.5 * sign })],
        ]);
        for (const [hinge, swing] of ORIENTATIONS) {
          const p = resolvePlacement(
            f,
            req(middle(f, 't'), {
              subject: subject({ hinge, swing }),
              from: { wall: 's', grab: 0 },
              free: true,
            }),
          )!;
          expect(p.wall).toBe('t');
          expect([p.hinge, p.swing]).toEqual([hinge, swing]);
        }
      }
    }
    // A dot of -1e-9 is noise too.
    const f = wallsFloor([
      ['s', { x: 0, y: 0 }, { x: 3, y: 0 }],
      ['t', { x: 6, y: -1.5 }, { x: 6 - 3e-9, y: 1.5 }],
    ]);
    const p = resolvePlacement(
      f,
      req(middle(f, 't'), { from: { wall: 's', grab: 0 }, free: true }),
    )!;
    expect([p.hinge, p.swing]).toEqual(['a', 'left']);
  });

  it('unrelated walls facing back mirror both hinge and swing', () => {
    for (const to of [
      { x: 6, y: 1 },
      { x: 4.5, y: 2.6 },
    ]) {
      const f = wallsFloor([
        ['s', { x: 0, y: 0 }, { x: 3, y: 0 }],
        ['t', { x: 9, y: 1 }, to],
      ]);
      for (const [hinge, swing] of ORIENTATIONS) {
        const p = resolvePlacement(
          f,
          req(middle(f, 't'), {
            subject: subject({ hinge, swing }),
            from: { wall: 's', grab: 0 },
            free: true,
          }),
        )!;
        expect([p.hinge, p.swing]).toEqual([
          hinge === 'a' ? 'b' : 'a',
          swing === 'left' ? 'right' : 'left',
        ]);
      }
    }
  });
});

describe('placement on a wall: a new opening', () => {
  it('opens to the side of the wall the pointer is on', () => {
    const f = wallsFloor([['w', { x: 0, y: 0 }, { x: 4, y: 0 }]]);
    expect(resolvePlacement(f, req({ x: 2, y: 0.2 }))!.swing).toBe('left');
    expect(resolvePlacement(f, req({ x: 2, y: -0.2 }))!.swing).toBe('right');
    const g = wallsFloor([['w', { x: 4, y: 0 }, { x: 0, y: 0 }]]);
    expect(resolvePlacement(g, req({ x: 2, y: 0.2 }))!.swing).toBe('right');
    expect(resolvePlacement(g, req({ x: 2, y: -0.2 }))!.swing).toBe('left');
  });

  it('keeps the hinge it was given', () => {
    const f = wallsFloor([['w', { x: 0, y: 0 }, { x: 4, y: 0 }]]);
    const p = resolvePlacement(f, req({ x: 2, y: -0.2 }, { subject: subject({ hinge: 'b' }) }))!;
    expect([p.hinge, p.swing]).toEqual(['b', 'right']);
  });

  it('works from a known host too', () => {
    const f = wallsFloor([['w', { x: 0, y: 0 }, { x: 4, y: 0 }]]);
    expect(resolvePlacement(f, req({ x: 2, y: -2 }, { wall: 'w' }))!.swing).toBe('right');
  });
});
