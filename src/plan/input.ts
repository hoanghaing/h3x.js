import type { HitTarget } from './hit';
import type { Tool } from './tools/Tool';
import type { PlanPointerEvent } from './tools/Tool';
import type { ScreenPoint } from './types';
import { panBy, zoomAt, type View } from './view';
import type { Vec2 } from '../core';

/** What the input handler needs from the plan. */
export interface InputHost {
  readonly svg: SVGSVGElement;
  readonly view: View;
  setView(v: Partial<Pick<View, 'cx' | 'cy' | 'scale'>>): void;
  screenToPlan(s: ScreenPoint): Vec2;
  hitAt(s: ScreenPoint): HitTarget;
  readonly tool: Tool | null;
}

/** Wheel zoom sensitivity: factor = exp(-deltaY * WHEEL_ZOOM). */
const WHEEL_ZOOM = 0.0015;

type Mode = 'none' | 'tool' | 'pan' | 'pinch';

const mid = (a: ScreenPoint, b: ScreenPoint): ScreenPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** Turns DOM pointer, wheel and keyboard events on the plan SVG into tool calls, panning and zooming. */
export class PlanInput {
  private readonly pointers = new Map<number, ScreenPoint>();
  private mode: Mode = 'none';
  /** The pointer driving the current tool or pan gesture. */
  private primary = -1;
  private toolSawDown = false;
  private last: ScreenPoint = { x: 0, y: 0 };
  private pinchDist = 0;
  private pinchMid: ScreenPoint = { x: 0, y: 0 };
  private readonly listeners: Array<[string, EventListener, AddEventListenerOptions?]> = [];

  constructor(private readonly host: InputHost) {
    this.on('pointerdown', (e) => this.down(e as PointerEvent));
    this.on('pointermove', (e) => this.move(e as PointerEvent));
    this.on('pointerup', (e) => this.up(e as PointerEvent));
    this.on('pointercancel', (e) => this.up(e as PointerEvent));
    this.on('dblclick', (e) => this.dblclick(e as MouseEvent));
    this.on('wheel', (e) => this.wheel(e as WheelEvent), { passive: false });
    this.on('keydown', (e) => {
      if (host.tool?.onKeyDown?.(e as KeyboardEvent)) e.preventDefault();
    });
    this.on('keyup', (e) => host.tool?.onKeyUp?.(e as KeyboardEvent));
    this.on('pointerleave', () => host.tool?.onPointerLeave?.());
  }

  /** Forgets the gesture in progress (the tool was swapped); the held pointer is ignored until released. */
  cancelGesture(): void {
    if (this.mode === 'pinch') return;
    this.mode = 'none';
    this.toolSawDown = false;
    this.primary = -1;
  }

  dispose(): void {
    for (const [type, fn, opts] of this.listeners)
      this.host.svg.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
    this.pointers.clear();
    this.mode = 'none';
  }

  private on(type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    this.host.svg.addEventListener(type, fn, opts);
    this.listeners.push([type, fn, opts]);
  }

  private screenOf(e: MouseEvent): ScreenPoint {
    const r = this.host.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private planEvent(e: PointerEvent | MouseEvent, screen: ScreenPoint): PlanPointerEvent {
    return {
      native: e,
      screen,
      plan: this.host.screenToPlan(screen),
      hit: this.host.hitAt(screen),
    };
  }

  private down(e: PointerEvent): void {
    // Only the primary (touch, pen tip, left) and middle buttons drive the plan.
    if (e.button !== 0 && e.button !== 1) return;
    const svg = this.host.svg;
    const screen = this.screenOf(e);
    this.pointers.set(e.pointerId, screen);
    if (typeof svg.setPointerCapture === 'function') {
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer may already be gone */
      }
    }
    svg.focus?.({ preventScroll: true });

    if (this.pointers.size === 2) {
      // A second finger ends whatever the first one started; the tool sees nothing more.
      if (this.mode === 'tool' && this.toolSawDown) {
        const first = this.pointers.get(this.primary);
        if (first) this.host.tool?.onPointerUp?.(this.planEvent(e, first));
      }
      this.toolSawDown = false;
      this.mode = 'pinch';
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2 || this.mode === 'pinch') return;

    this.primary = e.pointerId;
    this.last = screen;
    this.toolSawDown = false;
    this.mode = 'pan';
    if (e.button === 1) {
      e.preventDefault();
      return;
    }
    const tool = this.host.tool;
    if (tool?.onPointerDown) {
      this.toolSawDown = true;
      if (tool.onPointerDown(this.planEvent(e, screen))) this.mode = 'tool';
    }
  }

  private move(e: PointerEvent): void {
    const screen = this.screenOf(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, screen);
    if (this.mode === 'pinch') {
      this.updatePinch();
      return;
    }
    if (e.pointerType === 'mouse' && e.buttons === 0 && this.pointers.has(e.pointerId)) {
      // The button was released where we never saw the pointerup. Mid-gesture: end it (a tool
      // sees its release) instead of letting a stale press follow the hovering mouse. After a
      // tool swap (no gesture): just forget the pointer so hover reaches the new tool.
      if (e.pointerId === this.primary && (this.mode === 'pan' || this.mode === 'tool')) {
        this.up(e);
        return;
      }
      if (this.mode === 'none') this.pointers.delete(e.pointerId);
    }
    if (this.pointers.size > 0 && e.pointerId !== this.primary) return;
    this.host.tool?.onPointerMove?.(this.planEvent(e, screen));
    if (this.mode === 'pan') {
      this.host.setView(panBy(this.host.view, screen.x - this.last.x, screen.y - this.last.y));
      this.last = screen;
    }
  }

  private up(e: PointerEvent): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.mode === 'pinch') {
      if (this.pointers.size < 2) this.mode = 'none';
      return;
    }
    if (e.pointerId !== this.primary) return;
    const toolSawDown = this.toolSawDown;
    // Reset even if the tool throws, so input is never left mid-gesture.
    try {
      if (toolSawDown) this.host.tool?.onPointerUp?.(this.planEvent(e, this.screenOf(e)));
    } finally {
      this.mode = 'none';
      this.toolSawDown = false;
      this.primary = -1;
    }
  }

  private dblclick(e: MouseEvent): void {
    this.host.tool?.onDoubleClick?.(this.planEvent(e, this.screenOf(e)));
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const view = zoomAt(this.host.view, this.screenOf(e), Math.exp(-e.deltaY * WHEEL_ZOOM));
    this.host.setView(view);
  }

  private pinchPoints(): [ScreenPoint, ScreenPoint] {
    const [a, b] = [...this.pointers.values()];
    return [a!, b!];
  }

  private startPinch(): void {
    const [a, b] = this.pinchPoints();
    this.pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
    this.pinchMid = mid(a, b);
  }

  private updatePinch(): void {
    if (this.pointers.size < 2) return;
    const [a, b] = this.pinchPoints();
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const m = mid(a, b);
    let view = this.host.view;
    if (this.pinchDist > 0 && dist > 0) view = zoomAt(view, this.pinchMid, dist / this.pinchDist);
    view = panBy(view, m.x - this.pinchMid.x, m.y - this.pinchMid.y);
    this.host.setView(view);
    this.pinchDist = dist;
    this.pinchMid = m;
  }
}
