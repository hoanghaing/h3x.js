import type { H3xPlan, LengthEditRequest } from 'h3x/plan';

/**
 * Demo code: shows a number input over a wall's dimension label while a length
 * edit is requested. Enter applies, Esc or blur cancels. Returns a detach function.
 */
export function attachLengthInput(plan: H3xPlan, host: HTMLElement): () => void {
  let input: HTMLInputElement | undefined;

  const close = (): void => {
    const el = input;
    input = undefined;
    el?.remove();
  };

  const open = (e: LengthEditRequest): void => {
    close();
    const el = document.createElement('input');
    input = el;
    el.type = 'number';
    el.step = '0.01';
    el.value = String(Math.round(e.length * 1000) / 1000);
    Object.assign(el.style, {
      position: 'absolute',
      left: `${e.anchorRect.x}px`,
      top: `${e.anchorRect.y}px`,
      width: '72px',
      zIndex: '5',
      border: '1px solid #888',
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        close();
      } else if (ev.key === 'Enter') {
        const res = plan.setWallLength(e.wallId, Number(el.value), { anchor: e.anchor });
        if (res.ok) {
          close();
        } else {
          el.style.borderColor = '#b3261e';
          el.title = res.issues[0]?.message || 'Giá trị không hợp lệ';
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

  const off = plan.on('lengthEditRequest', open);
  return () => {
    off();
    close();
  };
}

/**
 * Demo code: while a wall is being drawn, shows an input at the bottom of the plan. Enter
 * commits a segment of that length, or `length<angle` (degrees counter-clockwise from +x, e.g.
 * `5<90` goes up 5 m); the plan then asks for the next one, which reopens the input. Esc or
 * blur closes it. Returns a detach function.
 */
export function attachSegmentLengthInput(plan: H3xPlan, host: HTMLElement): () => void {
  let input: HTMLInputElement | undefined;

  const close = (): void => {
    const el = input;
    input = undefined;
    el?.remove();
  };

  const open = (): void => {
    close();
    const el = document.createElement('input');
    input = el;
    el.type = 'text';
    el.inputMode = 'decimal';
    el.placeholder = 'Dài hoặc dài<góc';
    Object.assign(el.style, {
      position: 'absolute',
      left: '12px',
      bottom: '12px',
      width: '110px',
      zIndex: '5',
      border: '1px solid #888',
    });
    el.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        close();
      } else if (ev.key === 'Enter') {
        const m = /^\s*([\d.,]+)\s*(?:<\s*(-?[\d.,]+))?\s*$/.exec(el.value);
        const num = (t: string): number => Number(t.replace(',', '.'));
        const length = m ? num(m[1]!) : NaN;
        const angle = m?.[2] !== undefined ? num(m[2]) : undefined;
        if (
          !Number.isFinite(length) ||
          length <= 0 ||
          (angle !== undefined && !Number.isFinite(angle))
        ) {
          el.style.borderColor = '#b3261e';
          return;
        }
        // On success the plan asks for the next segment, which replaces this input.
        if (!plan.setPendingSegmentLength(length, angle)) {
          el.style.borderColor = '#b3261e';
          el.title = 'Giá trị không hợp lệ';
        }
      }
    });
    el.addEventListener('blur', () => {
      if (input === el) close();
    });
    host.appendChild(el);
    // Focus after the click that opened it: the browser focuses the plan on mousedown, which
    // would blur (and close) an input focused during pointerdown.
    setTimeout(() => {
      if (input === el) el.focus();
    }, 0);
  };

  const off = plan.on('segmentLengthRequest', open);
  return () => {
    off();
    close();
  };
}
