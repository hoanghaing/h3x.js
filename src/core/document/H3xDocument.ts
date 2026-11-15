import { FORMAT_VERSION } from '../constants';
import { H3xValidationError } from '../errors';
import { normalizeRoomOrientation } from '../rooms/normalize';
import { layoutValidator, validateLayout } from '../validate/layout';
import { placementValidator, validatePlacements } from '../validate/placement';
import type { Floor, Issue, PresetResolver, Project } from '../types';
import { projectFromXML } from '../xml/parse';
import { projectToXML } from '../xml/serialize';
import { applyChanges } from './changes';
import type { Command, EntityChange } from './changes';
import { Emitter } from './emitter';
import { History } from './history';

export type { Command, CommandContext, EntityChange } from './changes';

export interface ChangeEvent {
  reason: 'execute' | 'undo' | 'redo' | 'load';
  /** Deep-cloned snapshots. For undo, entries are inverted so `after` is always the new state. */
  changes: EntityChange[];
}
export type Validator = (doc: H3xDocument, changes: EntityChange[]) => Issue[];

const invert = (changes: EntityChange[]): EntityChange[] =>
  changes
    .slice()
    .reverse()
    .map((c) => ({ ...c, before: c.after, after: c.before }));

export class H3xDocument {
  readonly presets?: PresetResolver;
  private readonly _project: Project;
  private readonly history = new History();
  private readonly emitter = new Emitter<ChangeEvent>();
  private readonly validators: Validator[] = [];

  private constructor(project: Project, presets?: PresetResolver) {
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
      nodes: {},
      walls: {},
      openings: {},
      rooms: {},
      items: {},
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

  static fromProject(p: Project, opts: { presets?: PresetResolver } = {}): H3xDocument {
    const project = structuredClone(p);
    for (const f of project.floors) normalizeRoomOrientation(f);
    return new H3xDocument(project, opts.presets);
  }

  /** Live internal object. Callers must not mutate it. */
  get project(): Readonly<Project> {
    return this._project;
  }

  /** Live internal floors[0]. Callers must not mutate it. */
  get floor(): Readonly<Floor> {
    return this._project.floors[0]!;
  }

  private get mutableFloor(): Floor {
    return this._project.floors[0]!;
  }

  toXML(opts: { pretty?: boolean } = {}): string {
    return projectToXML(this._project, opts);
  }

  /** All layout issues, including non-blocking ones. */
  validateLayout(): Issue[] {
    return validateLayout(this.floor as Floor);
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

  /** Apply and validate; reverts on any issue or validator error. */
  private attempt(cmd: Command): { changes: EntityChange[]; issues: Issue[] } {
    const changes = structuredClone(cmd.run({ floor: this.floor, presets: this.presets }));
    applyChanges(this.mutableFloor, changes, 'forward');
    let issues: Issue[];
    try {
      issues = this.validators.flatMap((v) => v(this, changes));
    } catch (err) {
      applyChanges(this.mutableFloor, changes, 'backward');
      throw err;
    }
    if (issues.length > 0) applyChanges(this.mutableFloor, changes, 'backward');
    return { changes, issues };
  }

  /** Push to history, then emit. A throwing listener does not undo the commit. */
  private commit(changes: EntityChange[], key?: string): void {
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
      changes = structuredClone(cmd.run({ floor: this.floor, presets: this.presets }));
    } catch (err) {
      if (err instanceof H3xValidationError) return err.issues;
      throw err;
    }
    applyChanges(this.mutableFloor, changes, 'forward');
    try {
      return this.validators.flatMap((v) => v(this, changes));
    } finally {
      applyChanges(this.mutableFloor, changes, 'backward');
    }
  }

  undo(): boolean {
    const changes = this.history.popUndo();
    if (!changes) return false;
    applyChanges(this.mutableFloor, changes, 'backward');
    this.emitter.emit({ reason: 'undo', changes: structuredClone(invert(changes)) });
    return true;
  }

  redo(): boolean {
    const changes = this.history.popRedo();
    if (!changes) return false;
    applyChanges(this.mutableFloor, changes, 'forward');
    this.emitter.emit({ reason: 'redo', changes: structuredClone(changes) });
    return true;
  }
}
