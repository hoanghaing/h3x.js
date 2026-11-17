/// <reference types="vite/client" />
import {
  H3xDocument,
  addFloor,
  removeFloor,
  setFloorHeight,
  setGroundElevation,
  setSlabThickness,
  updateStair,
  type Stair,
} from 'h3x/core';
import {
  ColumnTool,
  DrawSiteTool,
  DrawWallTool,
  H3xPlan,
  SelectEditTool,
  StairTool,
} from 'h3x/plan';
import { H3xScene, H3xViewer, type H3xViewMode } from 'h3x/three';
import layoutXml from './layouts/nha-ong-4x16.h3x?raw';
import townhouseXml from './layouts/townhouse-3f.xml?raw';
import { attachLengthInput, attachSegmentLengthInput } from './lengthInput';
import { nextProjection, projectionLabel } from './projection';
import { widenHouse } from './widen';

const planHost = document.getElementById('plan')!;
const appHost = document.getElementById('app')!;

let doc: H3xDocument;
let scene: H3xScene;
let viewer: H3xViewer;
let plan: H3xPlan;
let teardown: Array<() => void> = [];

/** Attaches a plan and a 3D viewer to `next`, disposing whatever was attached before. */
function mount(next: H3xDocument): void {
  for (const fn of teardown) fn();
  doc = next;
  scene = new H3xScene(doc);
  viewer = new H3xViewer(appHost, scene);
  scene.setViewMode(viewSelect.value as H3xViewMode);
  viewer.fitToContent();
  plan = new H3xPlan(planHost, doc, { stairLabels: { up: 'LÊN', down: 'XUỐNG' } });
  plan.fitToContent();
  teardown = [
    attachLengthInput(plan, planHost),
    attachSegmentLengthInput(plan, planHost),
    doc.on('change', refreshFloorControls),
    doc.on('activefloor', refreshFloorControls),
    doc.on('change', refreshStairControls),
    doc.on('activefloor', refreshStairControls),
    plan.on('selectionchange', refreshStairControls),
    plan.on('issues', ({ standing }) => {
      if (standing.length > 0) say(`${standing.length} vấn đề tồn tại`, true);
      else say('');
    }),
    () => plan.dispose(),
    () => viewer.dispose(),
    () => scene.dispose(),
  ];
  refreshFloorControls();
  refreshStairControls();
}

const status = document.getElementById('status')!;
const say = (text: string, error = false): void => {
  status.textContent = text;
  status.className = error ? 'error' : '';
};
const on = (id: string, fn: () => void): void =>
  document.getElementById(id)!.addEventListener('click', fn);

const floorSelect = document.getElementById('sel-floor') as HTMLSelectElement;
const wallHeightInput = document.getElementById('in-wall-height') as HTMLInputElement;
const slabInput = document.getElementById('in-slab') as HTMLInputElement;
const groundInput = document.getElementById('in-ground') as HTMLInputElement;

/** Syncs the floor picker and number inputs with the document. */
function refreshFloorControls(): void {
  const floors = [...doc.project.floors].reverse();
  floorSelect.replaceChildren(
    ...floors.map((f) => {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = `Tầng ${f.level}`;
      return o;
    }),
  );
  floorSelect.value = doc.activeFloorId;
  const f = doc.floor;
  wallHeightInput.value = String(f.wallHeight);
  slabInput.value = String(f.slabThickness);
  groundInput.value = String(doc.project.floors.find((x) => x.level === 0)?.elevation ?? 0);
}

/** Runs a command, reporting a rejection in the status line. */
function run(cmd: Parameters<H3xDocument['tryExecute']>[0], ok: string): void {
  const r = doc.tryExecute(cmd);
  if (r.ok) say(ok);
  else say(`Không hợp lệ: ${r.issues.map((i) => i.message).join('; ')}`, true);
  refreshFloorControls();
}

const stairBar = document.getElementById('stairbar')!;
const stairTypeSelect = document.getElementById('sel-stair-type') as HTMLSelectElement;
const stairTurnSelect = document.getElementById('sel-stair-turn') as HTMLSelectElement;
const stairHandButton = document.getElementById('btn-stair-hand')!;
const stairWidthInput = document.getElementById('in-stair-width') as HTMLInputElement;

/** The stair selected in the plan, if any. */
function selectedStair(): Stair | undefined {
  const sel = plan.selection;
  return sel?.kind === 'stair' ? doc.floor.stairs[sel.id] : undefined;
}

/** Shows the stair controls only while a stair is selected and syncs them with it. */
function refreshStairControls(): void {
  const s = selectedStair();
  stairBar.style.display = s ? 'flex' : 'none';
  if (!s) return;
  stairTypeSelect.value = s.type;
  stairTurnSelect.value = s.turn;
  stairHandButton.textContent = s.hand === 'right' ? 'Tay phải' : 'Tay trái';
  stairWidthInput.value = String(s.flightWidth);
}

/** Updates the selected stair, reporting a rejection in the status line. */
function patchStair(patch: Partial<Omit<Stair, 'id'>>, ok: string): void {
  const s = selectedStair();
  if (s) run(updateStair(s.id, patch), ok);
  refreshStairControls();
}

const viewSelect = document.getElementById('sel-view') as HTMLSelectElement;

mount(H3xDocument.fromXML(townhouseXml));

floorSelect.addEventListener('change', () => doc.setActiveFloor(floorSelect.value));
on('btn-floor-above', () => run(addFloor({ position: 'above' }), 'Đã thêm tầng trên'));
on('btn-floor-below', () => run(addFloor({ position: 'below' }), 'Đã thêm tầng dưới'));
on('btn-floor-remove', () => run(removeFloor(doc.activeFloorId), 'Đã xóa tầng'));
wallHeightInput.addEventListener('change', () =>
  run(setFloorHeight(doc.activeFloorId, Number(wallHeightInput.value)), 'Đã đổi chiều cao tường'),
);
slabInput.addEventListener('change', () =>
  run(setSlabThickness(doc.activeFloorId, Number(slabInput.value)), 'Đã đổi độ dày sàn'),
);
groundInput.addEventListener('change', () =>
  run(setGroundElevation(Number(groundInput.value)), 'Đã đổi cao độ nền'),
);
viewSelect.addEventListener('change', () => scene.setViewMode(viewSelect.value as H3xViewMode));

on('btn-select', () => {
  plan.setTool(new SelectEditTool());
  say('Chọn: kéo nút / tường, nhấp đúp tường để thêm điểm, Shift + kéo tường để đẩy / kéo');
});
on('btn-wall', () => {
  plan.setTool(new DrawWallTool());
  say('Vẽ tường: nhấp từng điểm, Enter / nhấp đúp để kết thúc, gõ độ dài rồi Enter');
});
on('btn-site', () => {
  plan.setTool(new DrawSiteTool());
  say('Vẽ khu đất: nhấp từng đỉnh, nhấp đỉnh đầu hoặc Enter để đóng');
});
on('btn-column-round', () => {
  plan.setTool(new ColumnTool({ shape: 'round' }));
  say('Cột tròn: nhấp để đặt');
});
on('btn-column-square', () => {
  plan.setTool(new ColumnTool({ shape: 'square' }));
  say('Cột vuông: nhấp để đặt');
});
on('btn-stair', () => {
  plan.setTool(new StairTool({ type: 'U', turn: 'landing', hand: 'right', flightWidth: 0.9 }));
  say('Cầu thang: kéo một ô chữ nhật (bám góc mặt tường), chọn rồi chỉnh kiểu ở góc phải dưới');
});
stairTypeSelect.addEventListener('change', () =>
  patchStair({ type: stairTypeSelect.value as Stair['type'] }, 'Đã đổi kiểu cầu thang'),
);
stairTurnSelect.addEventListener('change', () =>
  patchStair({ turn: stairTurnSelect.value as Stair['turn'] }, 'Đã đổi kiểu chiếu'),
);
stairHandButton.addEventListener('click', () => {
  const s = selectedStair();
  if (s) patchStair({ hand: s.hand === 'right' ? 'left' : 'right' }, 'Đã đổi chiều quay');
});
stairWidthInput.addEventListener('change', () =>
  patchStair({ flightWidth: Number(stairWidthInput.value) }, 'Đã đổi bề rộng vế thang'),
);
on('btn-stair-rotate', () => {
  const s = selectedStair();
  if (s) patchStair({ rotation: s.rotation + Math.PI / 2 }, 'Đã xoay cầu thang 90°');
});
on('btn-clear', () => {
  mount(H3xDocument.create());
  say('Đã tạo bản vẽ trống');
});
on('btn-load', () => {
  mount(H3xDocument.fromXML(layoutXml));
  say('Đã nạp nhà ống');
});
on('btn-load-3f', () => {
  mount(H3xDocument.fromXML(townhouseXml));
  say('Đã nạp nhà phố 3 tầng');
});

// Derive from viewer.projection: viewFromAxis also switches to orthographic.
on('btn-projection', () => {
  viewer.setProjection(nextProjection(viewer.projection));
  say(projectionLabel(viewer.projection));
});
on('btn-top', () => viewer.viewFromAxis('y'));
on('btn-widen', () => {
  const r = widenHouse(doc, 0.5);
  if (r.ok) say('Đã mở rộng nhà thêm 0,5 m');
  else say(`Không hợp lệ: ${r.issues.map((i) => i.message).join('; ')}`, true);
});
on('btn-undo', () => {
  if (doc.canUndo) {
    doc.undo();
    say('Đã hoàn tác');
  } else say('Không còn gì để hoàn tác', true);
});
on('btn-redo', () => {
  if (doc.canRedo) {
    doc.redo();
    say('Đã làm lại');
  } else say('Không còn gì để làm lại', true);
});

// Ctrl/Cmd+Z undoes, Ctrl+Y or Ctrl/Cmd+Shift+Z redoes; ignored while typing in an input.
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) {
    if (doc.canUndo) doc.undo();
  } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
    if (doc.canRedo) doc.redo();
  } else return;
  e.preventDefault();
});
