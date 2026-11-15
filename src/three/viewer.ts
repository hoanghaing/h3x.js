import {
  Box3,
  type Camera,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  MathUtils,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AxisGizmo, type AxisName } from './gizmo';
import type { H3xScene } from './scene';

export interface RendererLike {
  domElement: HTMLCanvasElement;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  setPixelRatio(r: number): void;
  render(s: Scene, c: Camera): void;
  dispose(): void;
  shadowMap: { enabled: boolean };
}

export interface H3xViewerOptions {
  background?: string;
  grid?: boolean;
  gizmo?: boolean;
  shadows?: boolean;
  createRenderer?: () => RendererLike;
}

const FOV = 50;
/** The grid sits this far below the lowest content. */
const GRID_OFFSET = 0.005;
const TAN_HALF_FOV = Math.tan(MathUtils.degToRad(FOV / 2));
const AXIS_DIRS: Record<AxisName, Vector3> = {
  x: new Vector3(1, 0, 0),
  '-x': new Vector3(-1, 0, 0),
  y: new Vector3(0, 1, 0),
  '-y': new Vector3(0, -1, 0),
  z: new Vector3(0, 0, 1),
  '-z': new Vector3(0, 0, -1),
};

/** Renders an H3xScene on demand with perspective/orthographic cameras and orbit controls. */
export class H3xViewer {
  private readonly renderer: RendererLike;
  private readonly threeScene = new Scene();
  private readonly perspective = new PerspectiveCamera(FOV, 1, 0.1, 1000);
  private readonly ortho = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private cam: PerspectiveCamera | OrthographicCamera = this.perspective;
  private readonly controls: OrbitControls;
  private readonly light = new DirectionalLight(0xffffff, 1.5);
  private readonly grid: GridHelper | undefined;
  private readonly gizmo: AxisGizmo | undefined;
  private readonly offInvalidate: () => void;
  private readonly offGizmo: (() => void) | undefined;
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly onWindowResize = (): void => this.resize();
  private readonly prevContainerPosition: string;
  private orthoHalf = 5;
  private rafId: number | undefined;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly scene: H3xScene,
    opts: H3xViewerOptions = {},
  ) {
    this.renderer = opts.createRenderer
      ? opts.createRenderer()
      : new WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = opts.shadows ?? false;
    this.renderer.setPixelRatio(
      typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1,
    );
    this.threeScene.background = new Color(opts.background ?? '#f5f5f4');
    this.threeScene.add(scene.root);
    this.threeScene.add(new HemisphereLight(0xffffff, 0x8d8d8d, 2.5));
    this.threeScene.add(this.light, this.light.target);
    if (opts.shadows) this.light.castShadow = true;

    if (opts.grid ?? true) {
      this.grid = new GridHelper(100, 100, 0x999999, 0xcccccc);
      // Drawn first and without depth writes so it never z-fights the floors.
      const gm = this.grid.material;
      for (const m of Array.isArray(gm) ? gm : [gm]) m.depthWrite = false;
      this.grid.renderOrder = -1;
      this.threeScene.add(this.grid);
    }

    this.perspective.position.set(8, 8, 8);
    this.perspective.lookAt(0, 0, 0);

    this.prevContainerPosition = container.style.position;
    if (
      typeof getComputedStyle === 'function' &&
      getComputedStyle(container).position === 'static'
    ) {
      container.style.position = 'relative';
    }
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.cam, this.renderer.domElement);
    this.controls.addEventListener('change', this.onControlsChange);
    // A user drag takes over orientation from any axis-aligned `up` set by viewFromAxis.
    this.controls.addEventListener('start', this.onControlsStart);

    if (opts.gizmo ?? true) {
      this.gizmo = new AxisGizmo();
      this.offGizmo = this.gizmo.onSelect((axis) => this.viewFromAxis(axis));
      container.appendChild(this.gizmo.element);
    }

    this.offInvalidate = scene.onInvalidate(() => this.onSceneInvalidate());

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onWindowResize);
    }

    this.syncSceneDecor();
    this.resize();
    this.fitToContent();
  }

  get camera(): PerspectiveCamera | OrthographicCamera {
    return this.cam;
  }

  get projection(): 'perspective' | 'orthographic' {
    return this.cam === this.perspective ? 'perspective' : 'orthographic';
  }

  /** The point the camera orbits around (a copy). */
  get target(): Vector3 {
    return this.controls.target.clone();
  }

  setProjection(mode: 'perspective' | 'orthographic'): void {
    if (mode === this.projection) return;
    const from = this.cam;
    const to = mode === 'perspective' ? this.perspective : this.ortho;
    const target = this.controls.target;
    const dir = from.position.clone().sub(target);
    const dist = dir.length() || 1;
    dir.normalize();
    let newDist = dist;
    if (mode === 'orthographic') {
      // Match the framing of the perspective view at the target plane, but sit far
      // enough back that the whole content is inside the clip range.
      this.orthoHalf = dist * TAN_HALF_FOV;
      this.ortho.zoom = 1;
      newDist = Math.max(dist, this.contentRadius() * 2 + 1);
    } else {
      // Undo any orthographic zoom to find the equivalent perspective distance.
      newDist = this.orthoHalf / this.ortho.zoom / TAN_HALF_FOV;
    }
    to.up.copy(from.up);
    to.position.copy(target).addScaledVector(dir, newDist);
    this.cam = to;
    this.controls.object = to;
    this.updateClip(newDist);
    this.applyAspect();
    to.lookAt(target);
    this.controls.update();
    this.requestRender();
  }

  viewFromAxis(axis: AxisName): void {
    const current = this.cam.position.distanceTo(this.controls.target) || 10;
    this.setProjection('orthographic');
    const dist = Math.max(current, this.contentRadius() * 2 + 1);
    const cam = this.cam;
    const target = this.controls.target;
    // Plan +y is world -Z, so a top/bottom view keeps -Z up on screen (no rotation).
    if (axis === 'y' || axis === '-y') cam.up.set(0, 0, -1);
    else cam.up.set(0, 1, 0);
    cam.position.copy(target).addScaledVector(AXIS_DIRS[axis], dist);
    this.updateClip(dist);
    cam.lookAt(target);
    this.controls.update();
    this.requestRender();
  }

  fitToContent(): void {
    const box = new Box3().setFromObject(this.scene.root);
    if (box.isEmpty()) {
      this.requestRender();
      return;
    }
    const sphere = box.getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 0.5);
    const dist = (radius / Math.sin(MathUtils.degToRad(FOV / 2))) * 1.1;
    const cam = this.cam;
    const dir = cam.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-12) dir.set(1, 1, 1);
    dir.normalize();
    this.controls.target.copy(sphere.center);
    cam.position.copy(sphere.center).addScaledVector(dir, dist);
    if (cam === this.ortho) {
      this.orthoHalf = dist * TAN_HALF_FOV;
      this.ortho.zoom = 1;
      this.applyAspect();
    }
    this.updateClip(dist);
    cam.lookAt(sphere.center);
    this.controls.update();
    this.requestRender();
  }

  requestRender(): void {
    if (this.disposed || this.rafId !== undefined) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = undefined;
      if (this.disposed) return;
      this.renderNow();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }
    this.offInvalidate();
    this.resizeObserver?.disconnect();
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onWindowResize);
    this.controls.removeEventListener('change', this.onControlsChange);
    this.controls.removeEventListener('start', this.onControlsStart);
    this.controls.dispose();
    this.offGizmo?.();
    this.gizmo?.dispose();
    if (this.grid) {
      this.grid.geometry.dispose();
      const m = this.grid.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
    this.threeScene.remove(this.scene.root);
    this.light.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.container.style.position = this.prevContainerPosition;
  }

  private readonly onControlsChange = (): void => this.requestRender();

  private readonly onControlsStart = (): void => {
    if (this.cam.up.y !== 1) {
      this.cam.up.set(0, 1, 0);
    }
  };

  private onSceneInvalidate(): void {
    if (this.disposed) return;
    this.syncSceneDecor();
    this.requestRender();
  }

  /** Positions the key light relative to the content centre and the grid just under it. */
  private syncSceneDecor(): void {
    const box = new Box3().setFromObject(this.scene.root);
    const center = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
    this.light.target.position.copy(center);
    this.light.position.copy(center).add(new Vector3(5, 10, 7));
    if (this.grid) {
      const base = box.isEmpty() ? 0 : box.min.y;
      this.grid.position.set(Math.round(center.x), base - GRID_OFFSET, Math.round(center.z));
    }
  }

  private contentRadius(): number {
    const box = new Box3().setFromObject(this.scene.root);
    return box.isEmpty() ? 0 : box.getBoundingSphere(new Sphere()).radius;
  }

  private updateClip(dist: number): void {
    const radius = this.contentRadius();
    const far = Math.max(1000, dist * 20, dist + radius * 2);
    const near = Math.max(Math.min(dist / 1000, (dist - radius) / 2), 0.01);
    for (const cam of [this.perspective, this.ortho]) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  }

  private size(): { w: number; h: number } {
    return {
      w: Math.max(this.container.clientWidth, 1),
      h: Math.max(this.container.clientHeight, 1),
    };
  }

  private applyAspect(): void {
    const { w, h } = this.size();
    const aspect = w / h;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const half = this.orthoHalf;
    this.ortho.left = -half * aspect;
    this.ortho.right = half * aspect;
    this.ortho.top = half;
    this.ortho.bottom = -half;
    this.ortho.updateProjectionMatrix();
  }

  private resize(): void {
    if (this.disposed) return;
    const { w, h } = this.size();
    this.renderer.setSize(w, h);
    this.applyAspect();
    this.requestRender();
  }

  private renderNow(): void {
    this.renderer.render(this.threeScene, this.cam);
    this.gizmo?.update(this.cam.quaternion);
  }
}
