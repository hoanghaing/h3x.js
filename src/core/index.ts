export * from './constants';
export * from './types';
export * from './ids';
export * from './errors';

export { H3xDocument } from './document/H3xDocument';
export type {
  ActiveFloorEvent,
  ChangeEvent,
  Command,
  CommandContext,
  EntityChange,
  Validator,
} from './document/H3xDocument';

export { moveNode, moveWall, setWallLength } from './commands/layout';
export {
  addWall,
  splitWall,
  removeWall,
  removeNode,
  mergeNodes,
  dropNode,
  pushPullWall,
} from './commands/structure';
export type { NewWall, WallEnd } from './topology/ops';
export {
  addOpening,
  moveOpening,
  removeOpening,
  addItem,
  moveItem,
  removeItem,
} from './commands/objects';
export type { NewItem } from './commands/objects';
export { addColumn, moveColumn, removeColumn, setSite } from './commands/columns';
export { setWallFinish, setRoomFinish, renameRoom } from './commands/finishes';
export {
  addFloor,
  removeFloor,
  setFloorHeight,
  setSlabThickness,
  setGroundElevation,
} from './commands/floors';

export { validateLayout } from './validate/layout';
export { validatePlacements, checkItem, checkOpening } from './validate/placement';
export { detectRooms, roomPolygon, roomShape, roomArea } from './rooms/detect';
export type { DetectedRoom } from './rooms/detect';
export { polygonOverlapArea } from './geometry/clip';
export { projectToXML } from './xml/serialize';
export { projectFromXML } from './xml/parse';
export { obbCorners, wallOBB } from './geometry/obb';
export type { OBB } from './geometry/obb';
