// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { H3xDocument, type Project } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { attachLengthInput, attachSegmentLengthInput } from '../../examples/lengthInput';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

let plan: H3xPlan | undefined;

function setup(): { plan: H3xPlan; host: HTMLDivElement } {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(host);
  const doc = H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [oneRoomFloor()],
    } as Project,
    { presets: testPresets },
  );
  plan = new H3xPlan(host, doc);
  return { plan, host };
}

afterEach(() => {
  plan?.dispose();
  plan = undefined;
  document.body.innerHTML = '';
});

const key = (el: HTMLElement, k: string): void => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
};

describe('attachLengthInput', () => {
  it('edits a wall length with Enter, rejects bad values, closes on Esc', () => {
    const { plan: p, host } = setup();
    attachLengthInput(p, host);

    p.emitLengthEditRequest('w1');
    let input = host.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.value).toBe('4');

    input.value = '3';
    key(input, 'Enter');
    expect(p.doc.floor.nodes.n2).toMatchObject({ x: 3, y: 0 });
    expect(host.querySelector('input')).toBeNull();

    p.emitLengthEditRequest('w1');
    input = host.querySelector('input') as HTMLInputElement;
    input.value = '0.1';
    key(input, 'Enter');
    expect(host.querySelector('input')).toBe(input);
    expect(input.title).not.toBe('');

    key(input, 'Escape');
    expect(host.querySelector('input')).toBeNull();
  });

  it('removes the input on detach', () => {
    const { plan: p, host } = setup();
    const detach = attachLengthInput(p, host);
    p.emitLengthEditRequest('w1');
    detach();
    expect(host.querySelector('input')).toBeNull();
  });
});

describe('attachSegmentLengthInput', () => {
  const request = { from: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, length: 0 };

  it('calls setPendingSegmentLength on Enter and closes on Esc', () => {
    const { plan: p, host } = setup();
    const spy = vi.spyOn(p, 'setPendingSegmentLength').mockReturnValue(true);
    attachSegmentLengthInput(p, host);

    p.emitSegmentLengthRequest(request);
    const input = host.querySelector('input') as HTMLInputElement;
    input.value = '2.5';
    key(input, 'Enter');
    expect(spy).toHaveBeenCalledWith(2.5, undefined);
    input.value = '3<90';
    key(input, 'Enter');
    expect(spy).toHaveBeenLastCalledWith(3, 90);
    input.value = '1,5 < -45';
    key(input, 'Enter');
    expect(spy).toHaveBeenLastCalledWith(1.5, -45);
    input.value = '2<';
    key(input, 'Enter');
    expect(spy).toHaveBeenCalledTimes(3);

    key(input, 'Escape');
    expect(host.querySelector('input')).toBeNull();
  });

  it('ignores an empty value and removes the input on detach', () => {
    const { plan: p, host } = setup();
    const spy = vi.spyOn(p, 'setPendingSegmentLength').mockReturnValue(true);
    const detach = attachSegmentLengthInput(p, host);
    p.emitSegmentLengthRequest(request);
    key(host.querySelector('input') as HTMLInputElement, 'Enter');
    expect(spy).not.toHaveBeenCalled();
    detach();
    expect(host.querySelector('input')).toBeNull();
  });
});
