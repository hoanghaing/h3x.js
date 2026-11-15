# h3x.js

h3x is a TypeScript library for describing house models as XML. The scene is stored as XML, and each object type has its own element with matching attributes. This milestone provides `h3x/core` (document model, constants and, in later tasks, XML read/write and validation). Units are meters. three.js integration comes in later milestones.

## Development

```sh
pnpm install
pnpm test        # run tests once (vitest)
pnpm test:watch  # watch mode
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm format      # prettier --write
pnpm build       # vite library build to dist/
```
