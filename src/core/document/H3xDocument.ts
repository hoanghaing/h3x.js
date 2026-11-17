import { DEFAULT_SLAB_THICKNESS, FORMAT_VERSION } from '../constants';
import { normalizeFloors } from '../floors/stack';
import { H3xValidationError } from '../errors';
import { normalizeRoomOrientation } from '../rooms/normalize';
import { layoutValidator, validateLayout } from '../validate/layout';
import { checkRefs } from '../validate/refs';
import { placementValidator, validatePlacements } from '../validate/placement';
import type { Floor, Id, Issue, PresetResolver, Project } from '../types';
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
export interface ActiveFloorEvent {
  floorId: Id;
  previous: Id;
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
  private readonly activeEmitter = new Emitter<ActiveFloorEvent>();
  private readonly validators: Validator[] = [];
  private _activeFloorId: Id;

  private constructor(project: Project, presets?: PresetResolver) {
    normalizeFloors(project);
    this._project = project;
    // normalizeFloors guarantees a level-0 floor.
    this._activeFloorId = (project.floors.find((f) => f.level === 0) ?? project.floors[0]!).id;
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
   * Live internal active floor. Commands and validators operate on it.
   * Callers must not mutate it.
   */
  get floor(): Readonly<Floor> {
    // The fallback only shows while a change removing the active floor is being
    // validated; the active floor is moved right after every apply.
    return this.floorById(this._activeFloorId) ?? this._project.floors[0]!;
  }

  /** Id of the floor commands, validators and `floor` work on. Default: level 0. */
  get activeFloorId(): Id {
    return this._activeFloorId;
  }

  /**
   * Not undoable and not saved. Throws H3xValidationError 'unknown-floor' for a
   * bad id; a no-op for the current floor. Closes any open coalesced gesture.
   */
  setActiveFloor(id: Id): void {
    if (!this.floorById(id)) {
      throw new H3xValidationError([
        { code: 'unknown-floor', ids: [id], message: `No floor with id ${id}` },
      ]);
    }
    if (id === this._activeFloorId) return;
    const previous = this._activeFloorId;
    this.endCoalesce();
    this._activeFloorId = id;
    this.activeEmitter.emit({ floorId: id, previous });
  }

  /** Live internal floor. Callers must not mutate it. */
  floorById(id: Id): Readonly<Floor> | undefined {
    return this._project.floors.find((f) => f.id === id);
  }

  /** The floor one level below `id`, if any. */
  floorBelow(id: Id): Readonly<Floor> | undefined {
    const i = this._project.floors.findIndex((f) => f.id === id);
    return i > 0 ? this._project.floors[i - 1] : undefined;
  }

  /** The floor one level above `id`, if any. */
  floorAbove(id: Id): Readonly<Floor> | undefined {
    const i = this._project.floors.findIndex((f) => f.id === id);
    return i >= 0 ? this._project.floors[i + 1] : undefined;
  }

  private ctx(): CommandContext {
    const site = this._project.site;
    return {
      floor: this.floor,
      floorId: this._activeFloorId,
      project: this._project,
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

  on(type: 'change', fn: (e: ChangeEvent) => void): () => void;
  on(type: 'activefloor', fn: (e: ActiveFloorEvent) => void): () => void;
  on(
    type: 'change' | 'activefloor',
    fn: ((e: ChangeEvent) => void) | ((e: ActiveFloorEvent) => void),
  ): () => void {
    if (type === 'activefloor') return this.activeEmitter.on(fn as (e: ActiveFloorEvent) => void);
    return this.emitter.on(fn as (e: ChangeEvent) => void);
  }

  /**
   * Emit the change event for changes already applied, then, if the active floor
   * `previous` no longer exists, move it to the floor that was below it (`level`
   * is its level before the apply), else the lowest floor, and emit
   * 'activefloor'. A change-listener error is rethrown after that.
   */
  private emitChange(event: ChangeEvent, previous: Id, level: number): void {
    let failed = false;
    let error: unknown;
    try {
      this.emitter.emit(event);
    } catch (err) {
      failed = true;
      error = err;
    }
    if (!this.floorById(previous)) {
      const floors = this._project.floors;
      const next = floors.filter((f) => f.level < level).pop() ?? floors[0]!;
      this._activeFloorId = next.id;
      this.activeEmitter.emit({ floorId: next.id, previous });
    }
    if (failed) throw error;
  }

  /** Apply history changes (undo / redo / cancel) and emit. */
  private replay(
    changes: EntityChange[],
    dir: 'forward' | 'backward',
    reason: ChangeEvent['reason'],
  ): void {
    const previous = this._activeFloorId;
    const level = this.floor.level;
    applyChanges(this._project, changes, dir);
    const emitted = dir === 'forward' ? changes : invert(changes);
    this.emitChange({ reason, changes: structuredClone(emitted) }, previous, level);
  }

  /** Fills in the active floor id on changes that have none ('site' never gets one). */
  private stamp(changes: EntityChange[]): EntityChange[] {
    for (const c of changes) {
      if (c.kind === 'floor') c.floorId = c.id;
      else if (c.kind !== 'site' && c.floorId === undefined) c.floorId = this._activeFloorId;
    }
    return changes;
  }

  /** Validators see only active-floor and site changes, and are skipped when there are none. */
  private validate(changes: EntityChange[]): Issue[] {
    const own = changes.filter((c) => c.kind === 'site' || c.floorId === this._activeFloorId);
    if (own.length === 0) return [];
    return this.validators.flatMap((v) => v(this, own));
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
    this.replay(changes, 'backward', 'cancel');
    return true;
  }

  /**
   * Stamp, apply and validate; reverts on any issue or validator error.
   * `level` is the active floor's level before the apply.
   */
  private attempt(cmd: Command): { changes: EntityChange[]; issues: Issue[]; level: number } {
    const level = this.floor.level;
    const changes = this.stamp(structuredClone(cmd.run(this.ctx())));
    const bad = numberIssues(changes);
    if (bad.length > 0) return { changes, issues: bad, level };
    applyChanges(this._project, changes, 'forward');
    let issues: Issue[];
    try {
      issues = this.validate(changes);
    } catch (err) {
      applyChanges(this._project, changes, 'backward');
      throw err;
    }
    if (issues.length > 0) applyChanges(this._project, changes, 'backward');
    return { changes, issues, level };
  }

  /**
   * Push to history, then emit. A throwing listener does not undo the commit.
   * A no-op (no changes, or every change has before deep-equal to after) leaves
   * history (including its coalescing/seal state) untouched and emits nothing.
   */
  private commit(changes: EntityChange[], level: number, key?: string): void {
    if (changes.every((c) => deepEqual(c.before, c.after))) return;
    this.history.push(changes, key);
    const event: ChangeEvent = { reason: 'execute', changes: structuredClone(changes) };
    this.emitChange(event, this._activeFloorId, level);
  }

  /**
   * Throws H3xValidationError (state unchanged) on rejection. Listener errors are
   * rethrown after all listeners ran; the change is already committed by then.
   */
  execute(cmd: Command, opts: { coalesceKey?: string } = {}): void {
    const { changes, issues, level } = this.attempt(cmd);
    if (issues.length > 0) throw new H3xValidationError(issues);
    this.commit(changes, level, opts.coalesceKey);
  }

  /** Like execute but returns issues instead of throwing. Listener errors still propagate after the commit. */
  tryExecute(
    cmd: Command,
    opts: { coalesceKey?: string } = {},
  ): { ok: true } | { ok: false; issues: Issue[] } {
    let result: ReturnType<H3xDocument['attempt']>;
    try {
      result = this.attempt(cmd);
    } catch (err) {
      if (err instanceof H3xValidationError) return { ok: false, issues: err.issues };
      throw err;
    }
    if (result.issues.length > 0) return { ok: false, issues: result.issues };
    this.commit(result.changes, result.level, opts.coalesceKey);
    return { ok: true };
  }

  preview(cmd: Command): Issue[] {
    let changes: EntityChange[];
    try {
      changes = this.stamp(structuredClone(cmd.run(this.ctx())));
    } catch (err) {
      if (err instanceof H3xValidationError) return err.issues;
      throw err;
    }
    const bad = numberIssues(changes);
    if (bad.length > 0) return bad;
    applyChanges(this._project, changes, 'forward');
    try {
      return this.validate(changes);
    } finally {
      applyChanges(this._project, changes, 'backward');
    }
  }

  undo(): boolean {
    const changes = this.history.popUndo();
    if (!changes) return false;
    this.replay(changes, 'backward', 'undo');
    return true;
  }

  redo(): boolean {
    const changes = this.history.popRedo();
    if (!changes) return false;
    this.replay(changes, 'forward', 'redo');
    return true;
  }
}
