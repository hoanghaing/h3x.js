/// <reference types="vite/client" />
import {
  H3xDocument,
  addFloor,
  applyOpeningPreset,
  applyRoofPreset,
  isWarningIssue,
  removeFloor,
  setFloorHeight,
  setGroundElevation,
  setSlabThickness,
  stairParams,
  updateStair,
  type RoofPresetId,
  type Stair,
  type Transform,
} from 'h3x/core';
import {
  ColumnTool,
  DrawSiteTool,
  DrawWallTool,
  H3xPlan,
  OpeningTool,
  RoofTool,
  SelectEditTool,
  StairTool,
  type Tool,
} from 'h3x/plan';
import { H3xScene, H3xViewer, type H3xViewMode } from 'h3x/three';
import layoutXml from './layouts/nha-ong-4x16.h3x?raw';
import townhouseXml from './layouts/townhouse-3f.xml?raw';
import trapezoidXml from './layouts/townhouse-trapezoid.xml?raw';
import { attachLengthInput, attachSegmentLengthInput } from './lengthInput';
import { attachOpeningDistanceInput, attachOpeningPanel } from './openingPanel';
import { attachQuantitiesPanel } from './quantitiesPanel';
import { nextProjection, projectionLabel } from './projection';
import { widenHouse } from './widen';

const planHost = document.getElementById('plan')!;
const appHost = document.getElementById('app')!;

let doc: H3xDocument;
let scene: H3xScene;
let viewer: H3xViewer;
let plan: H3xPlan;
/** The OpeningTool in use, so the preset select can change it without re-creating it. */
let openingTool: OpeningTool | null = null;
let teardown: Array<() => void> = [];

/** Attaches a plan and a 3D viewer to `next`, disposing whatever was attached before. */
function mount(next: H3xDocument): void {
  for (const fn of teardown) fn();
  doc = next;
  scene = new H3xScene(doc);
  viewer = new H3xViewer(appHost, scene, { editing: true });
  openingTool = null;
  scene.setViewMode(viewSelect.value as H3xViewMode);
  viewer.setRoofsVisible(roofsCheck.checked);
  viewer.fitToContent();
  plan = new H3xPlan(planHost, doc, { stairLabels: { up: 'LÊN', down: 'XUỐNG' } });
  plan.setRoofsVisible(roofsCheck.checked);
  plan.fitToContent();
  teardown = [
    attachLengthInput(plan, planHost),
    attachSegmentLengthInput(plan, planHost),
    attachOpeningDistanceInput(plan, planHost, say),
    attachOpeningPanel(doc, plan, say),
    attachQuantitiesPanel(doc),
    doc.on('change', refreshFloorControls),
    doc.on('activefloor', refreshFloorControls),
    doc.on('change', refreshStairControls),
    doc.on('activefloor', refreshStairControls),
    plan.on('selectionchange', refreshStairControls),
    plan.on('selectionchange', (sel) => {
      // Show the selected roof's kind in the preset select.
      const preset = sel?.kind === 'roof' ? doc.floor.roofs[sel.id]?.preset : undefined;
      if (preset) roofPresetSelect.value = preset;
      // The same for the selected door or window.
      const opening = sel?.kind === 'opening' ? doc.floor.openings[sel.id] : undefined;
      if (opening && openingPresetSelect.querySelector(`option[value="${opening.preset}"]`)) {
        openingPresetSelect.value = opening.preset;
      }
    }),
    plan.on('roofdetached', () => say('Mái đã tách khỏi tường, giờ là đa giác độc lập')),
    plan.on('roofEdgeRequest', (r) => say(`Cạnh mái ${r.wallId ?? r.index}: ${r.current.kind}`)),
    plan.on('issues', ({ rejected, standing }) => {
      // A rejected edit (a click or drag of a tool) shows its reasons until the flash ends.
      if (rejected.length > 0) {
        const reasons = [...new Set(rejected.map((i) => i.message))];
        say(`Không hợp lệ: ${reasons.join('; ')}`, true);
      } else {
        // Warnings (a door leaf that cannot open fully) are counted apart from real problems.
        const warnings = standing.filter(isWarningIssue).length;
        const problems = standing.length - warnings;
        const parts = [
          problems > 0 ? `${problems} vấn đề tồn tại` : '',
          warnings > 0 ? `${warnings} cảnh báo` : '',
        ].filter(Boolean);
        say(parts.join(', '), problems > 0);
      }
    }),
    // Selection follows between plan and viewer; the ids are compared first, so neither side
    // echoes the other's change back.
    plan.on('selectionchange', () => {
      const n = plan.selectionSet.length;
      if (n > 1) say(`Đã chọn ${n} đối tượng`);
    }),
    plan.on('selectionchange', (sel) => {
      const want = sel?.kind === 'opening' ? { kind: 'opening' as const, id: sel.id } : null;
      if (viewer.selection?.id !== want?.id) viewer.select(want);
    }),
    viewer.on('selectionchange', (sel) => {
      if (sel?.id === (plan.selection?.kind === 'opening' ? plan.selection.id : undefined)) return;
      if (!sel && plan.selection?.kind !== 'opening') return;
      plan.select(sel ? { kind: 'opening', id: sel.id } : null);
    }),
    // Rejected pointer edits in 3D show their reasons in the same status line as the plan's.
    viewer.on('issues', (issues) => {
      if (issues.length === 0) return say('');
      const reasons = [...new Set(issues.map((i) => i.message))];
      say(`Không hợp lệ: ${reasons.join('; ')}`, true);
    }),
    () => plan.dispose(),
    () => viewer.dispose(),
    () => scene.dispose(),
  ];
  refreshFloorControls();
  refreshStairControls();
}

/** Sets the plan's tool; 3D placement is on only while the door and window tool is. */
function useTool(tool: Tool | null): void {
  plan.setTool(tool);
  openingTool = tool instanceof OpeningTool ? tool : null;
  viewer.setPlacement(openingTool ? { preset: openingPresetSelect.value } : null);
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
  const s = plan.selectionSet.length === 1 ? selectedStair() : undefined;
  stairBar.style.display = s ? 'flex' : 'none';
  if (!s) return;
  stairTypeSelect.value = s.type;
  stairTurnSelect.value = s.turn;
  stairHandButton.textContent = s.hand === 'right' ? 'Tay phải' : 'Tay trái';
  // Not while the user is typing in it: a keystroke may be mid-number or rejected.
  if (document.activeElement !== stairWidthInput) stairWidthInput.value = String(s.flightWidth);
  // Inputs that do not shape this type stay visible but disabled.
  const params = stairParams(s.type);
  stairTurnSelect.disabled = !params.includes('turn');
  stairHandButton.toggleAttribute('disabled', !params.includes('hand'));
  stairWidthInput.disabled = !params.includes('flightWidth');
}

/**
 * Updates the selected stair, reporting a rejection in the status line. Edits sharing a
 * `coalesceKey` (keystrokes in one input) make one undo step.
 */
function patchStair(patch: Partial<Omit<Stair, 'id'>>, ok: string, coalesceKey?: string): void {
  const s = selectedStair();
  if (s) {
    const r = doc.tryExecute(updateStair(s.id, patch), { coalesceKey });
    if (r.ok) say(ok);
    else say(`Không hợp lệ: ${r.issues.map((i) => i.message).join('; ')}`, true);
  }
  refreshStairControls();
}

const viewSelect = document.getElementById('sel-view') as HTMLSelectElement;
const roofsCheck = document.getElementById('chk-roofs') as HTMLInputElement;
const roofPresetSelect = document.getElementById('sel-roof-preset') as HTMLSelectElement;
const roofModeSelect = document.getElementById('sel-roof-mode') as HTMLSelectElement;
const openingPresetSelect = document.getElementById('sel-opening-preset') as HTMLSelectElement;

mount(H3xDocument.fromXML(townhouseXml));

floorSelect.addEventListener('change', () => doc.setActiveFloor(floorSelect.value));
// A new floor becomes the active one, so the next edit (or "Xóa tầng") acts on it.
const addFloorAndOpen = (position: 'above' | 'below', ok: string): void => {
  const cmd = addFloor({ position });
  run(cmd, ok);
  if (doc.project.floors.some((f) => f.id === cmd.createdId)) doc.setActiveFloor(cmd.createdId);
};
on('btn-floor-above', () => addFloorAndOpen('above', 'Đã thêm tầng trên'));
on('btn-floor-below', () => addFloorAndOpen('below', 'Đã thêm tầng dưới'));
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
  useTool(new SelectEditTool());
  say(
    'Chọn: kéo nút / tường / cửa, nhấp đúp tường để thêm điểm, Shift + kéo tường để đẩy / kéo, nhấp số khoảng cách cửa để sửa',
  );
});
on('btn-wall', () => {
  useTool(new DrawWallTool());
  say('Vẽ tường: nhấp từng điểm, Enter / nhấp đúp để kết thúc, gõ độ dài rồi Enter');
});
on('btn-site', () => {
  useTool(new DrawSiteTool());
  say('Vẽ khu đất: nhấp từng đỉnh, nhấp đỉnh đầu hoặc Enter để đóng');
});
/** Turns, mirrors or moves the whole selection; reports what happened in the status line. */
function transformSelection(t: (c: { x: number; y: number }) => Transform, done: string): void {
  const c = plan.selectionCenter();
  if (!c) return say('Chọn đối tượng trước (Shift / Ctrl + nhấp để chọn thêm)', true);
  if (plan.transformSelection(t(c))) say(done);
  else say('Không thực hiện được: kết quả không hợp lệ', true);
}
on('btn-rotate', () =>
  transformSelection((center) => ({ kind: 'rotate', center, angle: Math.PI / 2 }), 'Đã xoay 90°'),
);
on('btn-mirror-x', () =>
  transformSelection((c) => ({ kind: 'mirror', a: c, b: { x: c.x, y: c.y + 1 } }), 'Đã lật ngang'),
);
on('btn-mirror-y', () =>
  transformSelection((c) => ({ kind: 'mirror', a: c, b: { x: c.x + 1, y: c.y } }), 'Đã lật dọc'),
);
on('btn-move', () => {
  const x = (document.getElementById('in-move-x') as HTMLInputElement).valueAsNumber;
  const y = (document.getElementById('in-move-y') as HTMLInputElement).valueAsNumber;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return say('Nhập khoảng dời x, y (m)', true);
  transformSelection(() => ({ kind: 'translate', delta: { x, y } }), `Đã dời ${x}, ${y} m`);
});
on('btn-delete', () => {
  if (!plan.deleteSelection())
    say('Chọn một đối tượng để xoá (nút, tường, cửa, cột, cầu thang, mái, khu đất)', true);
  else say('Đã xoá');
});
// Delete / Backspace also works after using the toolbar (focus left the plan): the plan handles
// keys only while it has focus, so the page forwards them unless a text field is being edited.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  const t = e.target as HTMLElement | null;
  if (
    t?.closest('svg') ||
    t?.matches('input[type="text"], input[type="number"], input:not([type]), textarea')
  )
    return;
  if (plan.deleteSelection()) {
    e.preventDefault();
    say('Đã xoá');
  }
});
/** The RoofTool in use, so the preset / mode selects can change it without re-creating it. */
let roofTool: RoofTool | null = null;
const roofMode = (): 'follow' | 'draw' => (roofModeSelect.value === 'draw' ? 'draw' : 'follow');
on('btn-roof', () => {
  const mode = roofMode();
  roofTool = new RoofTool({ preset: roofPresetSelect.value as RoofPresetId, mode });
  useTool(roofTool);
  say(
    mode === 'follow'
      ? 'Vẽ mái: nhấp vào một phòng của tầng này (mái theo tường)'
      : 'Vẽ mái: nhấp từng đỉnh, nhấp đỉnh đầu hoặc Enter để đóng',
  );
});
// A new preset replaces the selected roof's kind at once (2D and 3D follow the change event) and
// applies to the next roofs the tool adds.
roofPresetSelect.addEventListener('change', () => {
  const preset = roofPresetSelect.value as RoofPresetId;
  roofTool?.setOptions({ preset });
  const sel = plan.selection;
  if (sel?.kind === 'roof') {
    const r = doc.tryExecute(applyRoofPreset(sel.id, preset));
    if (r.ok) say('Đã đổi kiểu mái');
    else say(`Không hợp lệ: ${r.issues.map((i) => i.message).join('; ')}`, true);
  }
});
roofModeSelect.addEventListener('change', () => roofTool?.setOptions({ mode: roofMode() }));
roofsCheck.addEventListener('change', () => {
  viewer.setRoofsVisible(roofsCheck.checked);
  plan.setRoofsVisible(roofsCheck.checked);
});
on('btn-column-round', () => {
  useTool(new ColumnTool({ shape: 'round' }));
  say('Cột tròn: nhấp để đặt');
});
on('btn-column-square', () => {
  useTool(new ColumnTool({ shape: 'square' }));
  say('Cột vuông: nhấp để đặt');
});
on('btn-stair', () => {
  useTool(new StairTool({ type: 'U', turn: 'landing', hand: 'right', flightWidth: 0.9 }));
  say('Cầu thang: kéo một ô chữ nhật (bám góc mặt tường), chọn rồi chỉnh kiểu ở góc phải dưới');
});
on('btn-opening', () => {
  useTool(new OpeningTool({ preset: openingPresetSelect.value }));
  say('Cửa: nhấp lên tường để đặt; Space đổi chiều mở, giữ Alt để bỏ bám');
});
// A new preset replaces the selected door or window's preset at once (same wall and centre) and
// applies to the next ones the tool places.
openingPresetSelect.addEventListener('change', () => {
  const preset = openingPresetSelect.value;
  openingTool?.setOptions({ preset });
  if (openingTool) viewer.setPlacement({ preset });
  const sel = plan.selection;
  if (sel?.kind === 'opening') {
    const r = doc.tryExecute(applyOpeningPreset(sel.id, preset));
    if (r.ok) say('Đã đổi mẫu cửa');
    else say(`Không hợp lệ: ${r.issues.map((i) => i.message).join('; ')}`, true);
  }
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
// Each keystroke that parses to a positive width applies at once (2D and 3D follow the change
// event); the keystrokes of one edit are one undo step, closed on change (Enter / blur).
stairWidthInput.addEventListener('input', () => {
  const v = Number(stairWidthInput.value);
  if (stairWidthInput.value.trim() !== '' && Number.isFinite(v) && v > 0) {
    patchStair({ flightWidth: v }, 'Đã đổi bề rộng vế thang', 'stair-width');
  }
});
stairWidthInput.addEventListener('change', () => {
  doc.endCoalesce();
  const s = selectedStair();
  if (s) stairWidthInput.value = String(s.flightWidth); // drop a rejected value
});
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

on('btn-load-trap', () => {
  mount(H3xDocument.fromXML(trapezoidXml));
  say('Đã nạp nhà phố hình thang (chọn tầng 3: sân thượng, tum, mái tôn, mái kính)');
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

// Handle for poking at the demo from the browser console.
(window as unknown as { h3x: object }).h3x = {
  get doc() {
    return doc;
  },
  get plan() {
    return plan;
  },
  get scene() {
    return scene;
  },
};
