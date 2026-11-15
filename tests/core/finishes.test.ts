// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { renameRoom, setRoomFinish, setWallFinish } from '../../src/core/commands/finishes';
import { H3xValidationError } from '../../src/core/errors';
import type { Project } from '../../src/core/types';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

const mk = (): H3xDocument =>
  H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [oneRoomFloor()],
    } as Project,
    { presets: testPresets },
  );

describe('finish commands', () => {
  it('setWallFinish sets and undo restores', () => {
    const doc = mk();
    const before = doc.floor.walls.w1!.finishLeft;
    doc.execute(setWallFinish('w1', 'left', 'paint-cream'));
    expect(doc.floor.walls.w1!.finishLeft).toBe('paint-cream');
    doc.undo();
    expect(doc.floor.walls.w1!.finishLeft).toBe(before);
  });

  it('setWallFinish right and clearing with undefined', () => {
    const doc = mk();
    doc.execute(setWallFinish('w1', 'right', 'tile'));
    expect(doc.floor.walls.w1!.finishRight).toBe('tile');
    doc.execute(setWallFinish('w1', 'right', undefined));
    expect('finishRight' in doc.floor.walls.w1!).toBe(false);
  });

  it('setRoomFinish sets, clears and undoes', () => {
    const doc = mk();
    doc.execute(setRoomFinish('r1', 'oak'));
    expect(doc.floor.rooms.r1!.floorFinish).toBe('oak');
    doc.execute(setRoomFinish('r1', undefined));
    expect(doc.floor.rooms.r1!.floorFinish).toBeUndefined();
    doc.undo();
    expect(doc.floor.rooms.r1!.floorFinish).toBe('oak');
  });

  it('renameRoom trims and survives an XML round-trip', () => {
    const doc = mk();
    doc.execute(renameRoom('r1', '  Phòng ngủ '));
    expect(doc.floor.rooms.r1!.name).toBe('Phòng ngủ');
    const back = H3xDocument.fromXML(doc.toXML());
    expect(back.floor.rooms.r1!.name).toBe('Phòng ngủ');
  });

  it('XML-forbidden characters are replaced with U+FFFD so the file reloads', () => {
    const doc = mk();
    doc.execute(renameRoom('r1', 'Bed\u0001room'));
    const back = H3xDocument.fromXML(doc.toXML());
    expect(back.floor.rooms.r1!.name).toBe('Bed�room');
    doc.execute(renameRoom('r1', 'a\u0000b\u000Bc￾d\uD800e\uDC00f\u{1F600}g'));
    const again = H3xDocument.fromXML(doc.toXML());
    expect(again.floor.rooms.r1!.name).toBe('a�b�c�d�e�f\u{1F600}g');
  });

  it('renameRoom allows an empty name', () => {
    const doc = mk();
    doc.execute(renameRoom('r1', '   '));
    expect(doc.floor.rooms.r1!.name).toBe('');
  });

  it('unknown ids give not-found', () => {
    const doc = mk();
    for (const cmd of [
      setWallFinish('nope', 'left', 'x'),
      setRoomFinish('nope', 'x'),
      renameRoom('nope', 'x'),
    ]) {
      try {
        doc.execute(cmd);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(H3xValidationError);
        expect((e as H3xValidationError).issues[0]!.code).toBe('not-found');
      }
    }
  });
});
