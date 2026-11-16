/// <reference types="vite/client" />
import { H3xDocument } from 'h3x/core';
import { H3xPlan } from 'h3x/plan';
import { H3xScene, H3xViewer } from 'h3x/three';
import layoutXml from './layouts/nha-ong-4x16.h3x?raw';
import { attachLengthInput } from './lengthInput';
import { nextProjection, projectionLabel } from './projection';
import { widenHouse } from './widen';

const doc = H3xDocument.fromXML(layoutXml);
const scene = new H3xScene(doc);
const viewer = new H3xViewer(document.getElementById('app')!, scene);
viewer.fitToContent();

const planHost = document.getElementById('plan')!;
const plan = new H3xPlan(planHost, doc);
attachLengthInput(plan, planHost);

const status = document.getElementById('status')!;
const say = (text: string, error = false): void => {
  status.textContent = text;
  status.className = error ? 'error' : '';
};
plan.on('issues', ({ standing }) => {
  if (standing.length > 0) say(`${standing.length} vấn đề tồn tại`, true);
  else say('');
});
const on = (id: string, fn: () => void): void =>
  document.getElementById(id)!.addEventListener('click', fn);

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
