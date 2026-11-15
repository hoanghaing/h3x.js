# Contributing to h3x

## Setup

Requires Node 22 and pnpm (CI uses pnpm 8).

```sh
pnpm install
```

| Script            | What it does                  |
| ----------------- | ----------------------------- |
| `pnpm test`       | run the tests once (vitest)   |
| `pnpm test:watch` | watch mode                    |
| `pnpm typecheck`  | `tsc --noEmit`                |
| `pnpm lint`       | eslint                        |
| `pnpm format`     | prettier (`--write .`)        |
| `pnpm build`      | vite library build to `dist/` |

CI runs typecheck, lint, test and build. All must pass before merging.

## Test-driven development

Write the failing test first, watch it fail for the right reason, then write the smallest code
that passes. Bug fixes start with a regression test. Tests live in `tests/core/` (shared
fixtures in `tests/fixtures/floors.ts`) and run under vitest with jsdom where XML is involved.
`README.md` is guarded by `tests/core/public-api.test.ts`: if you change the public API or the
README example, keep both in sync.

## Commit style

Conventional commits, as in `git log`: `feat(core): ...`, `fix(core): ...`, `refactor(core): ...`,
`test: ...`, `docs: ...`, `build: ...`, `style: ...`. Use the imperative, keep the subject short,
and say why in the body when it is not obvious.

## Code rules

- TypeScript `strict`. No `any` without a comment explaining why.
- No globals or module-level mutable state. Core is deterministic apart from `createId()` and
  the `created` timestamp in `H3xDocument.create`.
- Typed errors (`H3xParseError`, `H3xVersionError`, `H3xValidationError`) are never swallowed.
  Catch one only to translate it into an `Issue` or to rethrow, and re-throw anything else.
- Commands are pure: they compute `before` / `after` entity changes from the current floor and
  do not mutate it. `H3xDocument` applies the changes, validates, and records history.
- `src/core` must not import `three`, `vue` or any DOM API other than `DOMParser` in
  `xml/parse.ts`.
- All geometry comparisons use `GEOM_TOL`; do not add ad-hoc epsilons.
- Public API is whatever `src/core/index.ts` exports. Keep internals out of it.

## Adding a command

1. Write a test in `tests/core/` (for example next to `layout.test.ts` or `placement.test.ts`)
   covering the success case, undo, and each rejection.
2. Implement it in `src/core/commands/` (`layout.ts`, `objects.ts` or `finishes.ts`), following
   the existing commands: look up entities (throw `not-found` if missing), build the `after`
   state without mutating the floor, and return the entity changes.
3. Give creations a `createdId`, and make re-running them throw `duplicate-id`.
4. Export it from `src/core/index.ts` and add it to the Commands section of `README.md`.
5. If it can produce new states, make sure the existing validators cover them; see below.

## Adding a validator

1. Write failing tests for passing, failing and boundary cases (within `GEOM_TOL`).
2. Implement the check in `src/core/validate/layout.ts` (layout rules) or
   `src/core/validate/placement.ts` (openings and items). Return `Issue`s with a new
   kebab-case `code` and the involved `ids`.
3. Decide blocking vs reported-only. Blocking checks look only at touched entities and are wired
   through `layoutValidator` / `placementValidator`; placement checks must never block a change
   that touches a node. Whole-floor checks are added to `validateLayout` / `validatePlacements`.
4. Export new standalone checks from `src/core/index.ts`.
5. Document the code in `docs/validation.md` and the table in `README.md`.

## Format changes

Changes to the XML format need updates to `src/core/xml/parse.ts` and `serialize.ts`, a
round-trip test, and `docs/xml-format.md`. Follow the versioning policy there.

## Clean-room rule

h3x is written from scratch. Contributors must **not** copy, port or paraphrase code from any
prior or proprietary project, including ones you have worked on or have access to. Do not open
such code while working here. Only general ideas are reused: the scene is stored as XML, with one
element per object type and matching attributes. If you are unsure whether something crosses the
line, ask in the pull request before writing it.
