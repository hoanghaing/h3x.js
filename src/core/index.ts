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
  ExecuteOptions,
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
export {
  openingParams,
  openingLeaves,
  validateOpeningParams,
  mirrorOrientation,
  nextOrientation,
} from './openings/params';
export { normalizeOpening } from './openings/normalize';
export { OPENING_PRESETS, createPresetResolver } from './openings/presets';
export { addColumn, moveColumn, removeColumn, setSite } from './commands/columns';
export { addStair, updateStair, removeStair, validateStairParams } from './commands/stairs';
export {
  addRoof,
  updateRoof,
  setRoofParams,
  setRoofEdge,
  detachRoof,
  fitRoofToWalls,
  removeRoof,
  applyRoofPreset,
  validateRoofParams,
} from './commands/roofs';
export type { NewRoof, RoofPatch } from './commands/roofs';
export { ROOF_PRESETS, presetEdges, presetWallEdges } from './roofs/presets';
export type { RoofPresetId, RoofPreset } from './roofs/presets';
export { parseRoofEdge, formatRoofEdge } from './roofs/edges';
export { roofGeometry, roofFaceArea, gableProfile } from './roofs/geometry';
export type { Vec3, RoofFace, RoofBody, RoofGeometry, RoofLineKind } from './roofs/geometry';
export { layoutStair, stairBay, stairOutline, stairParams } from './stairs/layout';
export type { StairLayout, StairParam, StairPiece } from './stairs/layout';
export * from './stairs/constants';
export { setWallFinish, setRoomFinish, renameRoom } from './commands/finishes';
export {
  addFloor,
  removeFloor,
  setFloorHeight,
  setSlabThickness,
  setGroundElevation,
} from './commands/floors';

export { floorOutline } from './floors/outline';
export type { OutlineRing } from './floors/outline';

export { validateLayout } from './validate/layout';
export { validateStairs, stairRise } from './validate/stairs';
export { validateRoofs } from './validate/roofs';
export { validatePlacements, checkItem, checkOpening } from './validate/placement';
export { detectRooms, roomPolygon, roomShape, roomArea } from './rooms/detect';
export type { DetectedRoom } from './rooms/detect';
export { polygonOverlapArea } from './geometry/clip';
export { projectToXML } from './xml/serialize';
export { projectFromXML } from './xml/parse';
export { obbCorners, wallOBB } from './geometry/obb';
export {
  WALL_ITEM_DEPTH,
  circleOverlapArea,
  columnPolygon,
  columnShape,
  convexOverlap,
  itemFootprint,
  openingSpan,
  wallOutline,
  wallOutlines,
} from './shapes';
export type { WallCorners } from './walls/joins';
export type { OBB } from './geometry/obb';
