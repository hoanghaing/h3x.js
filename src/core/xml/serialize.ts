import { FORMAT_VERSION, XML_DECIMALS } from '../constants';
import { H3xValidationError } from '../errors';
import type { Column, Floor, Item, Project, Site } from '../types';

export function fmt(n: number): string {
  const v = Number(n.toFixed(XML_DECIMALS));
  return (Object.is(v, -0) ? 0 : v).toString();
}

/** XML 1.0 forbids C0 controls (except tab, LF, CR), U+FFFE / U+FFFF and lone surrogates. */
const FORBIDDEN_XML_CHARS =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function esc(s: string): string {
  return s
    .replace(FORBIDDEN_XML_CHARS, '\uFFFD')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
    .replace(/\t/g, '&#9;');
}

type AttrValue = string | number | undefined;

function el(name: string, attrs: Array<[string, AttrValue]>, children?: string[]): string {
  for (const [k, v] of attrs) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      const id = attrs[0]?.[0] === 'id' ? String(attrs[0][1]) : name;
      throw new H3xValidationError([
        {
          code: 'non-finite-number',
          ids: [id],
          message: `<${name}> attribute "${k}" of "${id}" is not a finite number`,
        },
      ]);
    }
  }
  const a = attrs
    .filter((p): p is [string, string | number] => p[1] !== undefined)
    .map(([k, v]) => ` ${k}="${esc(typeof v === 'number' ? fmt(v) : v)}"`)
    .join('');
  return children ? `<${name}${a}>\n${children.join('\n')}\n</${name}>` : `<${name}${a}/>`;
}

const byId = <T extends { id: string }>(rec: Record<string, T>): T[] =>
  Object.values(rec).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function itemEl(i: Item): string {
  const head: Array<[string, AttrValue]> = [
    ['id', i.id],
    ['preset', i.preset],
    ['variant', i.variant],
    ['mount', i.mount],
  ];
  if (i.mount === 'wall') {
    return el('item', [
      ...head,
      ['wall', i.wall],
      ['side', i.side],
      ['offset', i.offset],
      ['elevation', i.elevation],
    ]);
  }
  return el('item', [...head, ['x', i.x], ['y', i.y], ['rotation', i.rotation]]);
}

function columnEl(c: Column): string {
  return el('column', [
    ['id', c.id],
    ['x', c.x],
    ['y', c.y],
    ['shape', c.shape],
    ['width', c.width],
    ['depth', c.depth],
    ['rotation', c.rotation],
    ['height', c.height],
  ]);
}

function siteEl(s: Site): string {
  for (const p of s.points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new H3xValidationError([
        {
          code: 'non-finite-number',
          ids: ['site'],
          message: '<site> attribute "points" is not a finite number',
        },
      ]);
    }
  }
  return el('site', [['points', s.points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ')]]);
}

function floorEl(f: Floor): string {
  const kids = [
    ...byId(f.nodes).map((n) =>
      el('node', [
        ['id', n.id],
        ['x', n.x],
        ['y', n.y],
      ]),
    ),
    ...byId(f.walls).map((w) =>
      el('wall', [
        ['id', w.id],
        ['a', w.a],
        ['b', w.b],
        ['thickness', w.thickness],
        ['height', w.height],
        ['finishLeft', w.finishLeft],
        ['finishRight', w.finishRight],
      ]),
    ),
    ...byId(f.openings).map((o) =>
      el('opening', [
        ['id', o.id],
        ['wall', o.wall],
        ['preset', o.preset],
        ['offset', o.offset],
        ['width', o.width],
        ['height', o.height],
        ['sill', o.sill],
        ['flip', o.flip ? '1' : undefined],
      ]),
    ),
    ...byId(f.rooms).map((r) =>
      el('room', [
        ['id', r.id],
        ['walls', r.walls.join(' ')],
        ['holes', r.holes?.length ? r.holes.map((h) => h.join(' ')).join('; ') : undefined],
        ['name', r.name],
        ['floorFinish', r.floorFinish],
      ]),
    ),
    ...byId(f.items).map(itemEl),
    ...byId(f.columns).map(columnEl),
  ];
  return el(
    'floor',
    [
      ['id', f.id],
      ['level', f.level],
      ['elevation', f.elevation],
      ['wallHeight', f.wallHeight],
    ],
    kids.length ? kids : undefined,
  );
}

function indentXml(xml: string): string {
  let depth = 0;
  return xml
    .split('\n')
    .map((line) => {
      if (line.startsWith('</')) depth--;
      const out = '  '.repeat(Math.max(depth, 0)) + line;
      if (line.startsWith('<') && !line.startsWith('</') && !line.endsWith('/>')) depth++;
      return out;
    })
    .join('\n');
}

export function projectToXML(p: Project, opts: { pretty?: boolean } = {}): string {
  const body = [
    el('meta', [
      ['name', p.meta.name],
      ['created', p.meta.created],
    ]),
    ...(p.site ? [siteEl(p.site)] : []),
    ...p.floors.map(floorEl),
  ];
  const root = `<h3x version="${p.version ?? FORMAT_VERSION}" unit="${esc(p.unit)}">\n${body.join('\n')}\n</h3x>`;
  return opts.pretty ? indentXml(root) : root.replace(/\n/g, '');
}
