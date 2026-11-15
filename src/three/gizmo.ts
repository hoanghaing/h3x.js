import { Quaternion, Vector3 } from 'three';

export type AxisName = 'x' | '-x' | 'y' | '-y' | 'z' | '-z';

const AXES: Array<{ axis: AxisName; dir: Vector3 }> = [
  { axis: 'x', dir: new Vector3(1, 0, 0) },
  { axis: '-x', dir: new Vector3(-1, 0, 0) },
  { axis: 'y', dir: new Vector3(0, 1, 0) },
  { axis: '-y', dir: new Vector3(0, -1, 0) },
  { axis: 'z', dir: new Vector3(0, 0, 1) },
  { axis: '-z', dir: new Vector3(0, 0, -1) },
];

/**
 * Projects the six world axes into the view of a camera with orientation `q`.
 * x, y are screen coordinates in [-1, 1] (y up); depth is view-space z, so larger
 * means closer to the viewer. Sorted back-to-front.
 */
export function projectAxes(
  q: Quaternion,
): Array<{ axis: AxisName; x: number; y: number; depth: number }> {
  const inv = q.clone().invert();
  return AXES.map(({ axis, dir }) => {
    const v = dir.clone().applyQuaternion(inv);
    return { axis, x: v.x, y: v.y, depth: v.z };
  }).sort((a, b) => a.depth - b.depth);
}

const COLORS: Record<string, string> = { x: '#e5484d', y: '#30a46c', z: '#3e63dd' };

interface Placed {
  axis: AxisName;
  px: number;
  py: number;
  r: number;
}

/** Small canvas overlay showing the world axes; clicking one reports it. */
export class AxisGizmo {
  readonly element: HTMLCanvasElement;
  private readonly size: number;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly listeners = new Set<(axis: AxisName) => void>();
  private placed: Placed[] = [];

  constructor(opts: { size?: number } = {}) {
    this.size = opts.size ?? 96;
    this.element = document.createElement('canvas');
    this.element.width = this.size;
    this.element.height = this.size;
    this.element.style.width = `${this.size}px`;
    this.element.style.height = `${this.size}px`;
    this.element.style.position = 'absolute';
    this.element.style.top = '8px';
    this.element.style.right = '8px';
    this.element.style.cursor = 'pointer';
    // Null in headless environments (e.g. jsdom): drawing becomes a no-op.
    this.ctx = this.element.getContext('2d');
    this.element.addEventListener('click', this.onClick);
    this.update(new Quaternion());
  }

  update(q: Quaternion): void {
    const half = this.size / 2;
    const reach = half * 0.7;
    this.placed = projectAxes(q).map((p) => ({
      axis: p.axis,
      px: half + p.x * reach,
      py: half - p.y * reach,
      r: p.axis.startsWith('-') ? this.size * 0.04 : this.size * 0.1,
    }));
    this.draw(half);
  }

  onSelect(fn: (axis: AxisName) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  dispose(): void {
    this.element.removeEventListener('click', this.onClick);
    this.listeners.clear();
    this.element.remove();
  }

  private draw(half: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.lineWidth = 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(this.size * 0.12)}px sans-serif`;
    for (const p of this.placed) {
      const color = COLORS[p.axis.replace('-', '')] ?? '#888';
      const positive = !p.axis.startsWith('-');
      if (positive) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(half, half);
        ctx.lineTo(p.px, p.py);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.globalAlpha = positive ? 1 : 0.55;
      ctx.beginPath();
      ctx.arc(p.px, p.py, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (positive) {
        ctx.fillStyle = '#fff';
        ctx.fillText(p.axis.toUpperCase(), p.px, p.py);
      }
    }
  }

  private readonly onClick = (e: MouseEvent): void => {
    const rect = this.element.getBoundingClientRect();
    const sx = rect.width > 0 ? this.size / rect.width : 1;
    const sy = rect.height > 0 ? this.size / rect.height : 1;
    const x = (e.clientX - rect.left) * sx;
    const y = (e.clientY - rect.top) * sy;
    // Front-most hit wins: `placed` is back-to-front, so scan from the end.
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const p = this.placed[i]!;
      const slop = Math.max(p.r, this.size * 0.08);
      if (Math.hypot(x - p.px, y - p.py) <= slop) {
        for (const fn of [...this.listeners]) fn(p.axis);
        return;
      }
    }
  };
}
