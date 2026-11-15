export * from './constants';
export * from './types';
export * from './ids';
export * from './errors';

export { H3xDocument } from './document/H3xDocument';
export type {
  ChangeEvent,
  Command,
  CommandContext,
  EntityChange,
  Validator,
} from './document/H3xDocument';

export { moveNode, moveWall, setWallLength } from './commands/layout';
export {
  addOpening,
  moveOpening,
  removeOpening,
  addItem,
  moveItem,
  removeItem,
} from './commands/objects';
export type { NewItem } from './commands/objects';
export { setWallFinish, setRoomFinish, renameRoom } from './commands/finishes';

export { validateLayout } from './validate/layout';
export { validatePlacements, checkItem, checkOpening } from './validate/placement';
export { detectRooms, roomPolygon, roomArea } from './rooms/detect';
export { projectToXML } from './xml/serialize';
export { projectFromXML } from './xml/parse';
export { obbCorners, wallOBB } from './geometry/obb';
export type { OBB } from './geometry/obb';
