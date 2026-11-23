import { nanoid } from 'nanoid';

export function createId(): string {
  return nanoid(10);
}

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';

/** 32-bit FNV-1a of `s`, from the given offset basis. */
function fnv1a(s: string, basis: number): number {
  let h = basis;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * A 10-char id like `createId`'s, always the same for the same `key`: the first of
 * `key`, `key#1`, `key#2`, ... whose id is not `taken`.
 */
export function idFor(key: string, taken: (id: string) => boolean): string {
  for (let k = 0; ; k++) {
    const s = k === 0 ? key : `${key}#${k}`;
    const hi = fnv1a(s, 0x811c9dc5);
    const lo = fnv1a(s, 0x050c5d1f);
    let id = '';
    for (let i = 0; i < 5; i++) id += ALPHABET[(hi >>> (i * 6)) & 63];
    for (let i = 0; i < 5; i++) id += ALPHABET[(lo >>> (i * 6)) & 63];
    if (!taken(id)) return id;
  }
}
