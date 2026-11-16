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
