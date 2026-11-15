import { Color, MeshStandardMaterial } from 'three';

export interface FinishInfo {
  color: string;
}
export type FinishResolver = (finishId: string) => FinishInfo | undefined;

type Kind = 'wall' | 'floor' | 'trim';

/** Cached standard materials keyed by kind and resolved colour. */
export class MaterialLibrary {
  private readonly cache = new Map<string, MeshStandardMaterial>();
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

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
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
