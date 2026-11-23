import {
  estimate,
  floorQuantities,
  projectQuantities,
  type H3xDocument,
  type OpeningType,
  type PriceKey,
  type PriceTable,
} from 'h3x/core';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const num = (v: number, digits = 1): string =>
  v.toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const money = (v: number): string => Math.round(v).toLocaleString('vi-VN');

const UNIT_LABEL = { m: 'm', m2: 'm²', m3: 'm³', set: 'bộ' } as const;

/** Estimate rows, with demo unit prices in VND. Illustrative only: the library has no defaults. */
const ROWS: ReadonlyArray<{
  key: PriceKey;
  label: string;
  unit: keyof typeof UNIT_LABEL;
  price: number;
}> = [
  { key: 'masonry', label: 'Xây tường', unit: 'm3', price: 1_200_000 },
  { key: 'plaster', label: 'Trát tường', unit: 'm2', price: 90_000 },
  { key: 'paintInterior', label: 'Sơn trong', unit: 'm2', price: 45_000 },
  { key: 'paintExterior', label: 'Sơn ngoài', unit: 'm2', price: 60_000 },
  { key: 'slab', label: 'Bê tông sàn', unit: 'm3', price: 2_800_000 },
  { key: 'flooring', label: 'Lát nền', unit: 'm2', price: 350_000 },
  { key: 'ceiling', label: 'Trần', unit: 'm2', price: 180_000 },
  { key: 'skirting', label: 'Len chân tường', unit: 'm', price: 60_000 },
  { key: 'roof', label: 'Mái', unit: 'm2', price: 450_000 },
];

const OPENING_LABEL: Record<OpeningType, string> = {
  'door-swing': 'Cửa đi mở quay',
  'door-double': 'Cửa đi hai cánh',
  'door-sliding': 'Cửa đi trượt',
  'door-folding': 'Cửa xếp',
  'door-rolling': 'Cửa cuốn',
  opening: 'Lỗ trống',
  'window-casement': 'Cửa sổ mở quay',
  'window-sliding': 'Cửa sổ trượt',
  'window-awning': 'Cửa sổ hất',
  'window-fixed': 'Cửa sổ cố định',
};

/**
 * Demo code: the quantities and estimate panel. The toolbar button shows / hides it; while shown
 * it follows every document change and the active floor. Unit prices are edited in place (an
 * opening price applies per set to every door, or every window, type). Returns a detach function.
 */
export function attachQuantitiesPanel(doc: H3xDocument): () => void {
  const panel = el<HTMLElement>('quantities');
  const button = el<HTMLButtonElement>('btn-quantities');
  const scope = el<HTMLSelectElement>('sel-quantities-scope');
  const summary = el<HTMLElement>('quantities-summary');
  const openingsBody = el<HTMLTableSectionElement>('quantities-openings');
  const costBody = el<HTMLTableSectionElement>('quantities-costs');
  const doorPrice = el<HTMLInputElement>('in-price-door');
  const windowPrice = el<HTMLInputElement>('in-price-window');
  const total = el<HTMLElement>('quantities-total');
  const unpriced = el<HTMLElement>('quantities-unpriced');
  const listeners = new AbortController();
  const { signal } = listeners;

  // One row per priced key, built once so typing in a price input keeps its focus.
  costBody.replaceChildren();
  const cells = new Map<
    PriceKey,
    { input: HTMLInputElement; qty: HTMLElement; cost: HTMLElement }
  >();
  for (const r of ROWS) {
    const tr = document.createElement('tr');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '1000';
    input.value = String(r.price);
    const qty = document.createElement('td');
    const cost = document.createElement('td');
    const label = document.createElement('td');
    label.textContent = r.label;
    const price = document.createElement('td');
    price.append(input, ` /${UNIT_LABEL[r.unit]}`);
    qty.className = cost.className = 'num';
    tr.append(label, qty, price, cost);
    costBody.append(tr);
    cells.set(r.key, { input, qty, cost });
  }

  const priceOf = (input: HTMLInputElement): number | undefined =>
    input.value === '' || !Number.isFinite(input.valueAsNumber) ? undefined : input.valueAsNumber;

  const prices = (): PriceTable => {
    const table: PriceTable = {};
    for (const [key, c] of cells) {
      const p = priceOf(c.input);
      if (p !== undefined) table[key] = p;
    }
    const byType: Partial<Record<OpeningType, number>> = { opening: 0 };
    const door = priceOf(doorPrice);
    const win = priceOf(windowPrice);
    for (const t of Object.keys(OPENING_LABEL) as OpeningType[]) {
      if (t.startsWith('door-') && door !== undefined) byType[t] = door;
      if (t.startsWith('window-') && win !== undefined) byType[t] = win;
    }
    table.openings = { byType };
    return table;
  };

  const floorIndex = (): number => doc.project.floors.findIndex((f) => f.id === doc.floor.id);

  const render = (): void => {
    if (panel.hidden) return;
    const q =
      scope.value === 'floor'
        ? floorQuantities(doc.floor, doc.project.floors[floorIndex() - 1])
        : projectQuantities(doc.project);
    const t = q.totals;
    const slabHoles =
      'floors' in q ? q.floors.reduce((s, f) => s + f.slab.holeArea, 0) : q.slab.holeArea;
    const rows: Array<[string, string]> = [
      ['Tường', `${num(t.wallLength)} m · ${num(t.wallNetArea)} m² · ${num(t.wallVolume, 2)} m³`],
      [
        'Sàn',
        `${num(t.slabArea)} m²${slabHoles > 0 ? ` (trừ ${num(slabHoles)} m² lỗ cầu thang)` : ''} · ${num(t.slabVolume, 2)} m³`,
      ],
      ['Sơn trong', `${num(t.paintInterior)} m²`],
      ['Sơn ngoài', `${num(t.paintExterior)} m²`],
      ['Lát nền', `${num(t.floorArea)} m²`],
      ['Len chân tường', `${num(t.skirting)} m`],
      ['Mái', `${num(t.roofArea)} m²`],
    ];
    summary.replaceChildren(
      ...rows.map(([k, v]) => {
        const tr = document.createElement('tr');
        const th = document.createElement('th');
        th.textContent = k;
        const td = document.createElement('td');
        td.textContent = v;
        tr.append(th, td);
        return tr;
      }),
    );

    const e = estimate(q, prices());
    const openingRows = e.lines.filter((l) => l.key === 'opening');
    const groups = [
      ...openingRows.map((l) => ({ ...l, priced: true })),
      ...e.unpriced.map((o) => ({
        type: o.type,
        preset: o.preset,
        width: o.width,
        height: o.height,
        quantity: o.count,
        cost: 0,
        priced: false,
      })),
    ];
    openingsBody.replaceChildren(
      ...groups.map((g) => {
        const tr = document.createElement('tr');
        const values = [
          OPENING_LABEL[g.type!],
          `${num(g.width!, 2)} × ${num(g.height!, 2)}`,
          String(g.quantity),
          g.priced ? money(g.cost) : 'chưa có giá',
        ];
        for (const [i, v] of values.entries()) {
          const td = document.createElement('td');
          td.textContent = v;
          if (i > 1) td.className = 'num';
          tr.append(td);
        }
        tr.title = g.preset!;
        return tr;
      }),
    );
    if (groups.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = 'Chưa có cửa';
      tr.append(td);
      openingsBody.append(tr);
    }

    for (const [key, c] of cells) {
      const line = e.lines.find((l) => l.key === key);
      const unit = ROWS.find((r) => r.key === key)!.unit;
      c.qty.textContent = line
        ? `${num(line.quantity, unit === 'm3' ? 2 : 1)} ${UNIT_LABEL[unit]}`
        : '';
      c.cost.textContent = line ? money(line.cost) : '';
    }
    total.textContent = `${money(e.total)} đ`;
    unpriced.textContent =
      e.unpriced.length > 0
        ? `${e.unpriced.length} nhóm cửa chưa có giá, không tính vào tổng.`
        : '';
  };

  const show = (visible: boolean): void => {
    panel.hidden = !visible;
    button.classList.toggle('active', visible);
    render();
  };

  button.addEventListener('click', () => show(panel.hidden), { signal });
  el('btn-quantities-close').addEventListener('click', () => show(false), { signal });
  scope.addEventListener('change', render, { signal });
  panel.addEventListener(
    'input',
    (ev) => {
      if (ev.target instanceof HTMLInputElement) render();
    },
    { signal },
  );
  const offs = [doc.on('change', render), doc.on('activefloor', render)];
  render();

  return () => {
    listeners.abort();
    for (const off of offs) off();
  };
}
