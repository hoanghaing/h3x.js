// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import type { ChangeEvent, Command, EntityChange } from '../../src/core/document/H3xDocument';
import { applyChanges } from '../../src/core/document/changes';
import { H3xValidationError } from '../../src/core/errors';
import { moveNode } from '../../src/core/commands/layout';
import { removeFloor } from '../../src/core/commands/floors';
import type { Project } from '../../src/core/types';

const FLOOR_BODY = `
    <node id="n1" x="0" y="0"/>
    <node id="n2" x="4" y="0"/>
    <wall id="w1" a="n1" b="n2" thickness="0.2" height="3"/>`;

function twoFloors(extra = ''): H3xDocument {
  return H3xDocument.fromXML(`<h3x version="1" unit="m">
  <meta name="t" created="2026-11-17T00:00:00Z"/>
  <floor id="f1" level="1" elevation="3.15" wallHeight="3">${FLOOR_BODY}
  </floor>
  <floor id="f0" level="0" elevation="0" wallHeight="3">${FLOOR_BODY}
  </floor>${extra}
</h3x>`);
}

const nx = (d: H3xDocument, f: string): number => d.floorById(f)!.nodes.n1!.x;

describe('active floor', () => {
  it('defaults to the level-0 floor', () => {
    const d = twoFloors();
    expect(d.activeFloorId).toBe('f0');
    expect(d.floor.id).toBe('f0');
  });

  it('floor helpers find floors by id and by stack position', () => {
    const d = twoFloors();
    expect(d.floorById('f1')!.level).toBe(1);
    expect(d.floorById('nope')).toBeUndefined();
    expect(d.floorAbove('f0')!.id).toBe('f1');
    expect(d.floorBelow('f1')!.id).toBe('f0');
    expect(d.floorBelow('f0')).toBeUndefined();
    expect(d.floorAbove('f1')).toBeUndefined();
  });

  it('execute changes only the active floor and stamps floorId', () => {
    const d = twoFloors();
    const events: ChangeEvent[] = [];
    d.on('change', (e) => events.push(e));
    d.setActiveFloor('f1');
    expect(d.floor.id).toBe('f1');
    d.execute(moveNode('n1', { x: 0.5, y: 0 }));
    expect(nx(d, 'f1')).toBe(0.5);
    expect(nx(d, 'f0')).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.changes.every((c) => c.floorId === 'f1')).toBe(true);
    d.undo();
    expect(nx(d, 'f1')).toBe(0);
    expect(events[1]!.changes.every((c) => c.floorId === 'f1')).toBe(true);
  });

  it('a coalesced gesture does not merge across a floor switch', () => {
    const d = twoFloors();
    d.execute(moveNode('n1', { x: 0.5, y: 0 }), { coalesceKey: 'drag' });
    d.setActiveFloor('f1');
    d.execute(moveNode('n1', { x: 0.7, y: 0 }), { coalesceKey: 'drag' });
    expect(nx(d, 'f0')).toBe(0.5);
    expect(nx(d, 'f1')).toBe(0.7);
    expect(d.undo()).toBe(true);
    expect(nx(d, 'f1')).toBe(0);
    expect(nx(d, 'f0')).toBe(0.5);
    expect(d.undo()).toBe(true);
    expect(nx(d, 'f0')).toBe(0);
    expect(nx(d, 'f1')).toBe(0);
    expect(d.activeFloorId).toBe('f1');
  });

  it('setActiveFloor rejects unknown ids and ignores the current floor', () => {
    const d = twoFloors();
    const seen: { floorId: string; previous: string }[] = [];
    d.on('activefloor', (e) => seen.push(e));
    let err: unknown;
    try {
      d.setActiveFloor('nope');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(H3xValidationError);
    expect((err as H3xValidationError).issues[0]!.code).toBe('unknown-floor');
    d.setActiveFloor('f0');
    expect(seen).toEqual([]);
    d.setActiveFloor('f1');
    expect(seen).toEqual([{ floorId: 'f1', previous: 'f0' }]);
  });

  it('validators see only active-floor and site changes, and are skipped when none', () => {
    const d = twoFloors();
    const v = vi.fn(() => []);
    d.addValidator(v);
    const onOther: Command = {
      label: 'other',
      run: ({ project }) => {
        const n = project.floors.find((f) => f.id === 'f1')!.nodes.n1!;
        return [{ kind: 'node', id: 'n1', floorId: 'f1', before: n, after: { ...n, x: 1 } }];
      },
    };
    d.execute(onOther);
    expect(nx(d, 'f1')).toBe(1);
    expect(v).not.toHaveBeenCalled();

    const mixed: Command = {
      label: 'mixed',
      run: ({ project, floor }) => {
        const other = project.floors.find((f) => f.id === 'f1')!.nodes.n2!;
        return [
          { kind: 'node', id: 'n2', floorId: 'f1', before: other, after: { ...other, y: 1 } },
          { kind: 'node', id: 'n2', before: floor.nodes.n2!, after: { ...floor.nodes.n2!, y: 1 } },
          { kind: 'site', id: 'site', before: null, after: { id: 'site', points: [] } },
        ];
      },
    };
    d.execute(mixed);
    expect(v).toHaveBeenCalledTimes(1);
    const passed = (v.mock.calls[0] as unknown as [H3xDocument, EntityChange[]])[1];
    expect(passed.map((c) => [c.kind, c.floorId])).toEqual([
      ['node', 'f0'],
      ['site', undefined],
    ]);
  });

  it('applyChanges inserts and deletes a floor, keeping floors sorted', () => {
    const d = twoFloors();
    const project = structuredClone(d.project) as Project;
    const start = structuredClone(project);
    const props = { id: 'b1', level: -1, elevation: -3, wallHeight: 2.8, slabThickness: 0.2 };
    const change: EntityChange = {
      kind: 'floor',
      id: 'b1',
      floorId: 'b1',
      before: null,
      after: props,
    };
    applyChanges(project, [change], 'forward');
    expect(project.floors.map((f) => f.id)).toEqual(['b1', 'f0', 'f1']);
    expect(project.floors[0]).toMatchObject({
      ...props,
      nodes: {},
      walls: {},
      columns: {},
      stairs: {},
    });
    applyChanges(project, [change], 'backward');
    expect(project.floors).toEqual(start.floors);
  });

  it('applyChanges throws for a floorId that does not exist', () => {
    const project = structuredClone(twoFloors().project) as Project;
    const bad: EntityChange = {
      kind: 'node',
      id: 'n9',
      floorId: 'zz',
      before: null,
      after: { id: 'n9', x: 0, y: 0 },
    };
    expect(() => applyChanges(project, [bad], 'forward')).toThrow(/zz/);
  });

  it('moves the active floor down when it is removed, emitting after the change', () => {
    const d = twoFloors(`
  <floor id="f2" level="2" elevation="6.3" wallHeight="3"/>`);
    d.setActiveFloor('f2');
    const order: string[] = [];
    d.on('change', () => order.push('change'));
    d.on('activefloor', (e) => order.push(`active:${e.floorId}<-${e.previous}`));
    const props = { ...d.floorById('f2')! };
    const removeTop: Command = {
      label: 'remove',
      run: () => [
        {
          kind: 'floor',
          id: 'f2',
          floorId: 'f2',
          before: {
            id: props.id,
            level: props.level,
            elevation: props.elevation,
            wallHeight: props.wallHeight,
            slabThickness: props.slabThickness,
          },
          after: null,
        },
      ],
    };
    d.execute(removeTop);
    expect(d.activeFloorId).toBe('f1');
    expect(order).toEqual(['change', 'active:f1<-f2']);
    d.undo();
    expect(d.floorById('f2')).toBeDefined();
    expect(d.activeFloorId).toBe('f1');
  });

  it('skips validators when the change removes the active floor', () => {
    const d = twoFloors();
    d.setActiveFloor('f1');
    const spy = vi.fn(() => [{ code: 'always', ids: [], message: 'blocked' }]);
    d.addValidator(spy);
    d.execute(removeFloor('f1'));
    expect(spy).not.toHaveBeenCalled();
    expect(d.floorById('f1')).toBeUndefined();
    expect(d.activeFloorId).toBe('f0');
  });
});
