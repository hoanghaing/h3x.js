/// <reference types="vite/client" />
import { H3xDocument } from 'h3x/core';
import { ColumnTool, DrawSiteTool, DrawWallTool, H3xPlan, SelectEditTool } from 'h3x/plan';
import { H3xScene, H3xViewer } from 'h3x/three';
import layoutXml from './layouts/nha-ong-4x16.h3x?raw';
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
  viewer.fitToContent();
  plan = new H3xPlan(planHost, doc);
  plan.fitToContent();
  teardown = [
    attachLengthInput(plan, planHost),
    attachSegmentLengthInput(plan, planHost),
    plan.on('issues', ({ standing }) => {
      if (standing.length > 0) say(`${standing.length} vấn đề tồn tại`, true);
      else say('');
    }),
    () => plan.dispose(),
    () => viewer.dispose(),
    () => scene.dispose(),
  ];
}

const status = document.getElementById('status')!;
const say = (text: string, error = false): void => {
  status.textContent = text;
  status.className = error ? 'error' : '';
};
const on = (id: string, fn: () => void): void =>
  document.getElementById(id)!.addEventListener('click', fn);

mount(H3xDocument.fromXML(layoutXml));

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
on('btn-clear', () => {
  mount(H3xDocument.create());
  say('Đã tạo bản vẽ trống');
});
on('btn-load', () => {
  mount(H3xDocument.fromXML(layoutXml));
  say('Đã nạp nhà mẫu');
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
