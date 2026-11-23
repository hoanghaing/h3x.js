import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import type { RoofMaterial } from '../core';

export interface FinishInfo {
  color: string;
}
export type FinishResolver = (finishId: string) => FinishInfo | undefined;

type Kind = 'wall' | 'floor' | 'trim';

/** Colour, roughness, metalness and (translucent kinds) opacity per roof material. */
const ROOF_LOOK: Record<
  RoofMaterial,
  { color: string; roughness: number; metalness: number; opacity?: number }
> = {
  tile: { color: '#b35a3c', roughness: 0.85, metalness: 0 },
  metal: { color: '#6f8199', roughness: 0.45, metalness: 0.6 },
  concrete: { color: '#cfcdc8', roughness: 0.95, metalness: 0 },
  glass: { color: '#b9dbe8', roughness: 0.1, metalness: 0, opacity: 0.35 },
  polycarbonate: { color: '#e4ecef', roughness: 0.35, metalness: 0, opacity: 0.5 },
};

/** Cached standard materials keyed by kind and resolved colour. */
export class MaterialLibrary {
  private readonly cache = new Map<string, MeshStandardMaterial>();
  private pickMaterial: MeshBasicMaterial | undefined;
  private readonly resolveFinish: FinishResolver | undefined;
  private readonly defaults: Record<Kind, string>;

  constructor(
    opts: {
      resolveFinish?: FinishResolver;
      defaultWallColor?: string;
      defaultFloorColor?: string;
      trimColor?: string;
    } = {},
  ) {
    this.resolveFinish = opts.resolveFinish;
    this.defaults = {
      wall: opts.defaultWallColor ?? '#f2efe9',
      floor: opts.defaultFloorColor ?? '#c8b49a',
      trim: opts.trimColor ?? '#e2ddd5',
    };
  }

  wall(finishId?: string): MeshStandardMaterial {
    return this.get('wall', finishId);
  }

  floor(finishId?: string): MeshStandardMaterial {
    return this.get('floor', finishId);
  }

  trim(): MeshStandardMaterial {
    return this.get('trim');
  }

  /**
   * Roof material, named `roof-<material>`. Glass and polycarbonate are translucent
   * (opacity 0.35 / 0.5), double-sided and do not write depth.
   */
  roof(material: RoofMaterial): MeshStandardMaterial {
    const key = 'roof:' + material;
    let m = this.cache.get(key);
    if (!m) {
      const look = ROOF_LOOK[material];
      m = new MeshStandardMaterial({
        color: new Color(look.color),
        roughness: look.roughness,
        metalness: look.metalness,
      });
      m.name = 'roof-' + material;
      if (look.opacity !== undefined) {
        m.transparent = true;
        m.opacity = look.opacity;
        m.depthWrite = false;
        m.side = DoubleSide;
      }
      this.cache.set(key, m);
    }
    return m;
  }

  /** Frame bars and posts of light roofs. */
  steel(): MeshStandardMaterial {
    const key = 'steel';
    let m = this.cache.get(key);
    if (!m) {
      m = new MeshStandardMaterial({ color: new Color('#5b6168'), roughness: 0.5, metalness: 0.7 });
      m.name = 'roof-steel';
      this.cache.set(key, m);
    }
    return m;
  }

  /** Door and window frames (`opening-frame`), also the box of a rolling door. */
  openingFrame(): MeshStandardMaterial {
    return this.named('opening-frame', { color: '#6b6560', roughness: 0.6, metalness: 0.3 });
  }

  /** Door leaves, sash members and shutters (`opening-leaf`). */
  openingLeaf(): MeshStandardMaterial {
    return this.named('opening-leaf', { color: '#8b6a4e', roughness: 0.7, metalness: 0 });
  }

  /** Window panes (`opening-glass`): translucent, double-sided, no depth write. */
  openingGlass(): MeshStandardMaterial {
    let m = this.cache.get('opening-glass');
    if (!m) {
      m = this.named('opening-glass', { color: '#b9dbe8', roughness: 0.1, metalness: 0 });
      m.transparent = true;
      m.opacity = 0.3;
      m.depthWrite = false;
      m.side = DoubleSide;
    }
    return m;
  }

  /** Never drawn (`visible` false), yet rays still hit meshes using it (`opening-pick`). */
  pick(): MeshBasicMaterial {
    if (!this.pickMaterial) {
      this.pickMaterial = new MeshBasicMaterial({ visible: false });
      this.pickMaterial.name = 'opening-pick';
    }
    return this.pickMaterial;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    this.pickMaterial?.dispose();
    this.pickMaterial = undefined;
  }

  private named(
    key: string,
    look: { color: string; roughness: number; metalness: number },
  ): MeshStandardMaterial {
    let m = this.cache.get(key);
    if (!m) {
      m = new MeshStandardMaterial({ ...look, color: new Color(look.color) });
      m.name = key;
      this.cache.set(key, m);
    }
    return m;
  }

  private resolveColor(kind: Kind, finishId?: string): string {
    if (finishId === undefined) return this.defaults[kind];
    if (finishId.startsWith('#')) return finishId;
    return this.resolveFinish?.(finishId)?.color ?? this.defaults[kind];
  }

  private get(kind: Kind, finishId?: string): MeshStandardMaterial {
    const color = this.resolveColor(kind, finishId);
    const key = `${kind}:${color}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new MeshStandardMaterial({ color: new Color(color), roughness: 0.9, metalness: 0 });
      this.cache.set(key, m);
    }
    return m;
  }
}
