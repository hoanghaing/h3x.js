/// <reference types="vite/client" />
import { H3xDocument } from 'h3x/core';
import { H3xScene, H3xViewer } from 'h3x/three';
import layoutXml from './layouts/nha-ong-4x16.h3x?raw';
import { widenHouse } from './widen';

const doc = H3xDocument.fromXML(layoutXml);
const scene = new H3xScene(doc);
const viewer = new H3xViewer(document.getElementById('app')!, scene);
viewer.fitToContent();

const status = document.getElementById('status')!;
const say = (text: string, error = false): void => {
  status.textContent = text;
  status.className = error ? 'error' : '';
};
const on = (id: string, fn: () => void): void =>
  document.getElementById(id)!.addEventListener('click', fn);

let ortho = false;
on('btn-projection', () => {
  ortho = !ortho;
  viewer.setProjection(ortho ? 'orthographic' : 'perspective');
  say(ortho ? 'Chế độ trực giao' : 'Chế độ phối cảnh');
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
