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

## Usage

```ts
import { H3xDocument, moveNode, roomArea } from 'h3x/core';

const xml = `<h3x version="1" unit="m">
  <floor id="f1" level="0" elevation="0" wallHeight="3.2">
    <node id="n1" x="0" y="0"/><node id="n2" x="4" y="0"/>
    <node id="n3" x="4" y="3"/><node id="n4" x="0" y="3"/>
    <wall id="w1" a="n1" b="n2" thickness="0.2" height="3.2"/>
    <wall id="w2" a="n2" b="n3" thickness="0.2" height="3.2"/>
    <wall id="w3" a="n3" b="n4" thickness="0.2" height="3.2"/>
    <wall id="w4" a="n4" b="n1" thickness="0.2" height="3.2"/>
    <room id="r1" walls="w1 w2 w3 w4" name="Living room"/>
  </floor>
</h3x>`;

const doc = H3xDocument.fromXML(xml);
doc.execute(moveNode('n3', { x: 5, y: 3 }));
doc.execute(moveNode('n2', { x: 5, y: 0 }));
console.log(roomArea(doc.floor, doc.floor.rooms.r1!, 'center')); // 15
console.log(doc.toXML());
doc.undo(); // every command is undoable
```
