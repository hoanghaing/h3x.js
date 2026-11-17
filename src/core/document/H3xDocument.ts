import { DEFAULT_SLAB_THICKNESS, FORMAT_VERSION } from '../constants';
import { normalizeFloors } from '../floors/stack';
import { H3xValidationError } from '../errors';
import { normalizeRoomOrientation } from '../rooms/normalize';
import { layoutValidator, validateLayout } from '../validate/layout';
import { checkRefs } from '../validate/refs';
import { placementValidator, validatePlacements } from '../validate/placement';
import type { Floor, Issue, PresetResolver, Project } from '../types';
import { projectFromXML } from '../xml/parse';
import { projectToXML } from '../xml/serialize';
import { applyChanges, swapChange } from './changes';
import type { Command, CommandContext, EntityChange } from './changes';
import { Emitter } from './emitter';
import { History, deepEqual } from './history';

export type { Command, CommandContext, EntityChange } from './changes';

export interface ChangeEvent {
  reason: 'execute' | 'undo' | 'redo' | 'load' | 'cancel';
  /** Deep-cloned snapshots. For undo, entries are inverted so `after` is always the new state. */
  changes: EntityChange[];
}
export type Validator = (doc: H3xDocument, changes: EntityChange[]) => Issue[];

const invert = (changes: EntityChange[]): EntityChange[] =>
  changes.slice().reverse().map(swapChange);

function hasNonFinite(v: unknown): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v !== 'object' || v === null) return false;
  return Object.values(v).some(hasNonFinite);
}

/** Blocking 'invalid-number' issues for changes whose new state holds NaN / Infinity. */
function numberIssues(changes: EntityChange[]): Issue[] {
  return changes
    .filter((c) => c.after !== null && hasNonFinite(c.after))
    .map((c) => ({
      code: 'invalid-number',
      ids: [c.id],
      message: `${c.kind} ${c.id} has a value that is not a finite number`,
    }));
}

export class H3xDocument {
  readonly presets?: PresetResolver;
  private readonly _project: Project;
  private readonly history = new History();
  private readonly emitter = new Emitter<ChangeEvent>();
  private readonly validators: Validator[] = [];

  private constructor(project: Project, presets?: PresetResolver) {
    normalizeFloors(project);
    this._project = project;
    this.presets = presets;
    this.validators.push(layoutValidator, placementValidator);
  }

  static create(opts: { name?: string; presets?: PresetResolver } = {}): H3xDocument {
    const floor: Floor = {
      id: 'f1',
      level: 0,
      elevation: 0,
      wallHeight: 3.2,
      slabThickness: DEFAULT_SLAB_THICKNESS,
      nodes: {},
      walls: {},
      openings: {},
      rooms: {},
      items: {},
      columns: {},
    };
    return new H3xDocument(
      {
        version: FORMAT_VERSION,
        unit: 'm',
        meta: { name: opts.name ?? '', created: new Date().toISOString() },
        floors: [floor],
      },
      opts.presets,
    );
  }

  static fromXML(xml: string, opts: { presets?: PresetResolver } = {}): H3xDocument {
    return new H3xDocument(projectFromXML(xml), opts.presets);
  }

  /**
   * Throws H3xValidationError 'no-floor' for an empty floor list and
   * 'bad-reference' for dangling wall / node references.
   */
  static fromProject(p: Project, opts: { presets?: PresetResolver } = {}): H3xDocument {
    if (p.floors.length === 0) {
      throw new H3xValidationError([
        { code: 'no-floor', ids: [], message: 'Project has no floor' },
      ]);
    }
    const project = structuredClone(p);
    for (const f of project.floors) {
      // Floors from before columns existed (M3) have no `columns` map.
      (f as { columns?: Floor['columns'] }).columns ??= {};
      (f as { slabThickness?: number }).slabThickness ??= DEFAULT_SLAB_THICKNESS;
      const bad = checkRefs(f);
      if (bad.length > 0) {
        throw new H3xValidationError(
          bad.map((r) => ({ code: 'bad-reference', ids: [r.id, r.target], message: r.message })),
        );
      }
      normalizeRoomOrientation(f);
    }
    return new H3xDocument(project, opts.presets);
  }

  /** Live internal object. Callers must not mutate it. */
  get project(): Readonly<Project> {
    return this._project;
  }

  /**
   * Live internal floors[0]. Phase-1 editing APIs (commands, validators, undo)
   * operate on floors[0] only; further floors are kept untouched and saved
   * as loaded. Callers must not mutate it.
   */
  get floor(): Readonly<Floor> {
    return this._project.floors[0]!;
  }

  private ctx(): CommandContext {
    const site = this._project.site;
    return {
      floor: this.floor,
      ...(site ? { site } : {}),
      presets: this.presets,
    };
  }

  toXML(opts: { pretty?: boolean } = {}): string {
    return projectToXML(this._project, opts);
  }

  /** All layout issues, including non-blocking ones. */
  validateLayout(): Issue[] {
    return validateLayout(this.floor as Floor, this._project.site);
  }

  /** All placement issues for openings and items, including pre-existing ones. */
  validatePlacements(): Issue[] {
    return validatePlacements(this.floor as Floor, this.presets ?? (() => undefined));
  }

  addValidator(v: Validator): void {
    this.validators.push(v);
  }

  on(_type: 'change', fn: (e: ChangeEvent) => void): () => void {
    return this.emitter.on(fn);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }

  endCoalesce(): void {
    this.history.seal();
  }

  /**
   * Revert the open coalesced gesture `key` as if it never happened: no undo entry
   * and the redo stack from before it is restored. Returns false (nothing changes,
   * nothing emitted) if the group is closed, has another key, or netted out to nothing.
   */
  cancelCoalesce(key: string): boolean {
    const changes = this.history.cancel(key);
    if (!changes) return false;
    applyChanges(this._project, changes, 'backward');
    this.emitter.emit({ reason: 'cancel', changes: structuredClone(invert(changes)) });
    return true;
  }

  /** Apply and validate; reverts on any issue or validator error. */
  private attempt(cmd: Command): { changes: EntityChange[]; issues: Issue[] } {
    const changes = structuredClone(cmd.run(this.ctx()));
    const bad = numberIssues(changes);
    if (bad.length > 0) return { changes, issues: bad };
    applyChanges(this._project, changes, 'forward');
    let issues: Issue[];
    try {
      issues = this.validators.flatMap((v) => v(this, changes));
    } catch (err) {
      applyChanges(this._project, changes, 'backward');
      throw err;
    }
    if (issues.length > 0) applyChanges(this._project, changes, 'backward');
    return { changes, issues };
  }

  /**
   * Push to history, then emit. A throwing listener does not undo the commit.
   * A no-op (no changes, or every change has before deep-equal to after) leaves
   * history (including its coalescing/seal state) untouched and emits nothing.
   */
  private commit(changes: EntityChange[], key?: string): void {
    if (changes.every((c) => deepEqual(c.before, c.after))) return;
    this.history.push(changes, key);
    this.emitter.emit({ reason: 'execute', changes: structuredClone(changes) });
  }

  /**
   * Throws H3xValidationError (state unchanged) on rejection. Listener errors are
   * rethrown after all listeners ran; the change is already committed by then.
   */
  execute(cmd: Command, opts: { coalesceKey?: string } = {}): void {
    const { changes, issues } = this.attempt(cmd);
    if (issues.length > 0) throw new H3xValidationError(issues);
    this.commit(changes, opts.coalesceKey);
  }

  /** Like execute but returns issues instead of throwing. Listener errors still propagate after the commit. */
  tryExecute(
    cmd: Command,
    opts: { coalesceKey?: string } = {},
  ): { ok: true } | { ok: false; issues: Issue[] } {
    const { changes, issues } = (() => {
      try {
        return this.attempt(cmd);
      } catch (err) {
        if (err instanceof H3xValidationError) return { changes: [], issues: err.issues };
        throw err;
      }
    })();
    if (issues.length > 0) return { ok: false, issues };
    this.commit(changes, opts.coalesceKey);
    return { ok: true };
  }

  preview(cmd: Command): Issue[] {
    let changes: EntityChange[];
    try {
      changes = structuredClone(cmd.run(this.ctx()));
    } catch (err) {
      if (err instanceof H3xValidationError) return err.issues;
      throw err;
    }
    const bad = numberIssues(changes);
    if (bad.length > 0) return bad;
    applyChanges(this._project, changes, 'forward');
    try {
      return this.validators.flatMap((v) => v(this, changes));
    } finally {
      applyChanges(this._project, changes, 'backward');
    }
  }

  undo(): boolean {
    const changes = this.history.popUndo();
    if (!changes) return false;
    applyChanges(this._project, changes, 'backward');
    this.emitter.emit({ reason: 'undo', changes: structuredClone(invert(changes)) });
    return true;
  }

  redo(): boolean {
    const changes = this.history.popRedo();
    if (!changes) return false;
    applyChanges(this._project, changes, 'forward');
    this.emitter.emit({ reason: 'redo', changes: structuredClone(changes) });
    return true;
  }
}
