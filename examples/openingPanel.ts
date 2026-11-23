import {
  openingLeaves,
  openingParams,
  updateOpening,
  type H3xDocument,
  type Opening,
  type OpeningType,
} from 'h3x/core';
import type { H3xPlan, OpeningDistanceRequest } from 'h3x/plan';

type Say = (text: string, error?: boolean) => void;
type Patch = Partial<Omit<Opening, 'id'>>;

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/**
 * Demo code: the bar of the selected door or window (type, size, sill, hinge, swing, leaves,
 * split). Inputs that do not shape the opening's type stay visible but disabled. A double-click
 * on an opening focuses the type picker. Returns a detach function.
 */
export function attachOpeningPanel(doc: H3xDocument, plan: H3xPlan, say: Say): () => void {
  const bar = el<HTMLElement>('openingbar');
  const typeSelect = el<HTMLSelectElement>('sel-opening-type');
  const hingeSelect = el<HTMLSelectElement>('sel-opening-hinge');
  const swingSelect = el<HTMLSelectElement>('sel-opening-swing');
  const numbers = {
    width: el<HTMLInputElement>('in-opening-width'),
    height: el<HTMLInputElement>('in-opening-height'),
    sill: el<HTMLInputElement>('in-opening-sill'),
    leaves: el<HTMLInputElement>('in-opening-leaves'),
    split: el<HTMLInputElement>('in-opening-split'),
  };
  const listeners = new AbortController();
  const { signal } = listeners;

  const selected = (): Opening | undefined => {
    const sel = plan.selection;
    return sel?.kind === 'opening' ? doc.floor.openings[sel.id] : undefined;
  };

  const values = (o: Opening): Record<keyof typeof numbers, number> => ({
    width: o.width,
    height: o.height,
    sill: o.sill,
    leaves: openingLeaves(o),
    split: o.split ?? 0.5,
  });

  /** Shows the bar only while an opening is selected and syncs it with that opening. */
  const refresh = (): void => {
    const o = selected();
    bar.style.display = o ? 'flex' : 'none';
    if (!o) return;
    typeSelect.value = o.type;
    hingeSelect.value = o.hinge;
    swingSelect.value = o.swing;
    const v = values(o);
    for (const [key, input] of Object.entries(numbers) as [
      keyof typeof numbers,
      HTMLInputElement,
    ][]) {
      // Not while the user is typing in it: a keystroke may be mid-number or rejected.
      if (document.activeElement !== input) input.value = String(v[key]);
    }
    const params = openingParams(o);
    hingeSelect.disabled = !params.includes('hinge');
    swingSelect.disabled = !params.includes('swing');
    numbers.leaves.disabled = !params.includes('leaves');
    numbers.split.disabled = !params.includes('split');
  };

  /**
   * Updates the selected opening, reporting a rejection in the status line. Edits sharing a
   * `coalesceKey` (keystrokes in one input) make one undo step.
   */
  const patch = (p: Patch, ok: string, coalesceKey?: string): void => {
    const o = selected();
    if (o) {
      const r = doc.tryExecute(updateOpening(o.id, p), { coalesceKey });
      if (r.ok) say(ok);
      else say(`Không hợp lệ: ${r.issues.map((i) => i.message).join('; ')}`, true);
    }
    refresh();
  };

  typeSelect.addEventListener(
    'change',
    () => patch({ type: typeSelect.value as OpeningType }, 'Đã đổi loại cửa'),
    { signal },
  );
  hingeSelect.addEventListener(
    'change',
    () => patch({ hinge: hingeSelect.value as Opening['hinge'] }, 'Đã đổi phía bản lề'),
    { signal },
  );
  swingSelect.addEventListener(
    'change',
    () => patch({ swing: swingSelect.value as Opening['swing'] }, 'Đã đổi hướng mở'),
    { signal },
  );

  const numberEdits: Record<keyof typeof numbers, { ok: string; accept: (v: number) => boolean }> =
    {
      width: { ok: 'Đã đổi bề rộng cửa', accept: (v) => v > 0 },
      height: { ok: 'Đã đổi chiều cao cửa', accept: (v) => v > 0 },
      sill: { ok: 'Đã đổi cao độ bậu', accept: (v) => v >= 0 },
      leaves: { ok: 'Đã đổi số cánh', accept: (v) => Number.isInteger(v) && v >= 1 },
      split: { ok: 'Đã đổi tỉ lệ cánh', accept: (v) => v >= 0.5 && v < 1 },
    };
  for (const [key, input] of Object.entries(numbers) as [
    keyof typeof numbers,
    HTMLInputElement,
  ][]) {
    const edit = numberEdits[key];
    // Each keystroke that parses to an acceptable value applies at once (2D and 3D follow the
    // change event); the keystrokes of one edit are one undo step, closed on change.
    input.addEventListener(
      'input',
      () => {
        const v = Number(input.value);
        if (input.value.trim() !== '' && Number.isFinite(v) && edit.accept(v)) {
          patch({ [key]: v }, edit.ok, `opening-${key}`);
        }
      },
      { signal },
    );
    input.addEventListener(
      'change',
      () => {
        doc.endCoalesce();
        const o = selected();
        if (o) input.value = String(values(o)[key]); // drop a rejected value
      },
      { signal },
    );
  }

  const offs = [
    doc.on('change', refresh),
    doc.on('activefloor', refresh),
    plan.on('selectionchange', refresh),
    plan.on('openingEditRequest', () => {
      refresh();
      typeSelect.focus();
    }),
  ];
  refresh();
  return () => {
    for (const off of offs) off();
    listeners.abort();
    bar.style.display = 'none';
  };
}

/**
 * Demo code: shows a number input over a clear distance of the selected opening while the plan
 * asks for one. Enter applies (the opening moves, its width stays), Esc or blur cancels. A
 * rejection is shown on the input and in the status line. Returns a detach function.
 */
export function attachOpeningDistanceInput(plan: H3xPlan, host: HTMLElement, say: Say): () => void {
  let input: HTMLInputElement | undefined;

  const close = (): void => {
    const el = input;
    input = undefined;
    el?.remove();
  };

  const open = (e: OpeningDistanceRequest): void => {
    close();
    const el = document.createElement('input');
    input = el;
    el.type = 'number';
    el.step = '0.01';
    el.min = '0';
    el.value = String(Math.round(e.distance * 1000) / 1000);
    Object.assign(el.style, {
      position: 'absolute',
      left: `${e.at.x - 36}px`,
      top: `${e.at.y - 11}px`,
      width: '72px',
      zIndex: '5',
      border: '1px solid #888',
    });
    el.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        close();
      } else if (ev.key === 'Enter') {
        const distance = Number(el.value);
        const res =
          el.value.trim() === '' || !Number.isFinite(distance)
            ? { ok: false as const, issues: [] }
            : plan.setOpeningDistance(e.openingId, { end: e.end, distance });
        if (res.ok) {
          close();
          say('Đã đổi khoảng cách cửa');
        } else {
          const why = res.issues.map((i) => i.message).join('; ') || 'Giá trị không hợp lệ';
          el.style.borderColor = '#b3261e';
          el.title = why;
          say(`Không hợp lệ: ${why}`, true);
        }
      }
    });
    el.addEventListener('blur', () => {
      if (input === el) close();
    });
    host.appendChild(el);
    el.focus();
    el.select();
  };

  const off = plan.on('openingDistanceRequest', open);
  return () => {
    off();
    close();
  };
}
