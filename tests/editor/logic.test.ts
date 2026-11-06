import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  History, backgroundRefOf, contrastInk, duplicateLayer, hexToHsl, hexToRgb, hslToHex, insertAtCaret, longestRowIndex, makeLayer,
  normalizeHex, parseColour, resizeBox, rgbToHex, sampleValuesFor, snapToGuides,
} from '../../src/components/editor/logic';
import { builtinTemplate } from '../../src/lib/render/builtin';

test('colour parsing: hex, rgb(), hsl(), bad input', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('1F3A5F'), '#1f3a5f');
  assert.equal(normalizeHex('#12345'), null);
  assert.equal(parseColour('rgb(31, 58, 95)'), '#1f3a5f');
  assert.equal(parseColour('31 58 95'), '#1f3a5f');
  assert.equal(parseColour('rgb(300, 0, 0)'), null);
  assert.equal(parseColour('hsl(0, 100%, 50%)'), '#ff0000');
  assert.equal(parseColour('hsl(0, 120%, 50%)'), null);
  assert.equal(parseColour('banana'), null);
});

test('colour conversion round-trips every 17th RGB value within one unit', () => {
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
    const hex = rgbToHex(r, g, b);
    const { h, s, l } = hexToHsl(hex);
    const back = hexToRgb(hslToHex(h, s, l));
    assert.ok(Math.abs(back.r - r) <= 6 && Math.abs(back.g - g) <= 6 && Math.abs(back.b - b) <= 6, `${hex} -> hsl(${h},${s},${l}) -> ${JSON.stringify(back)}`);
  }
  assert.equal(contrastInk('#ffffff'), '#0f172a');
  assert.equal(contrastInk('#000000'), '#ffffff');
});

test('snapping lands the centre on the page centre and on other boxes, only within the threshold', () => {
  const box = { width: 100, height: 40 };
  const s = snapToGuides(box, 372, 100, [842, 595], [], 6);
  assert.equal(s.x + 50, 421);
  assert.equal(s.guideX, 421);
  assert.equal(s.guideY, null);
  const far = snapToGuides(box, 300, 100, [842, 595], [], 6);
  assert.equal(far.guideX, null);
  assert.equal(far.x, 300);
  const other = { id: 'o', content: '', x: 10, y: 300, width: 80, height: 20, style: {} as never };
  const s2 = snapToGuides(box, 0, 288, [842, 595], [other], 6);
  assert.equal(s2.guideX, 50);
  assert.equal(s2.guideY, 310);
});

test('resizing: east/south grow, west/north keep the opposite edge, minimum size holds, rotation is honoured', () => {
  const r = { x: 100, y: 100, width: 200, height: 50 };
  assert.deepEqual(resizeBox(r, 'se', 30, 10, 0), { x: 100, y: 100, width: 230, height: 60 });
  const nw = resizeBox(r, 'nw', 20, 10, 0);
  assert.equal(nw.x + nw.width, 300);
  assert.equal(nw.y + nw.height, 150);
  const tiny = resizeBox(r, 'e', -500, 0, 0);
  assert.equal(tiny.width, 20);
  const rot = resizeBox(r, 'e', 0, 40, 90);
  assert.equal(rot.width, 240);
});

test('history: undo, redo, redo cleared by a new edit, merged bursts, limit', () => {
  const h = new History<number>(3, 1000);
  assert.equal(h.canUndo, false);
  h.record(0, 'a', 0); h.record(1, 'a', 100); h.record(2, 'a', 200);
  assert.equal(h.undo(3), 0);
  assert.equal(h.canRedo, true);
  assert.equal(h.redo(0), 3);
  h.record(3, 'b', 5000);
  h.record(4, 'c', 5001);
  assert.equal(h.undo(5), 4);
  assert.equal(h.undo(4), 3);
  h.record(4, null, 9000);
  assert.equal(h.canRedo, false);
  const limited = new History<number>(2, 0);
  for (let i = 0; i < 10; i++) limited.record(i, null, i);
  assert.equal(limited.undo(10), 9);
  assert.equal(limited.undo(9), 8);
  assert.equal(limited.undo(8), undefined);
});

test('layers: new ids are unique, duplicates are offset and independent, fit settings are copied not shared', () => {
  const t = builtinTemplate('classic');
  const a = makeLayer(t);
  assert.ok(!t.layers.some((l) => l.id === a.id));
  const withA = { ...t, layers: [...t.layers, a] };
  const b = makeLayer(withA);
  assert.notEqual(a.id, b.id);
  assert.ok(b.y > a.y, 'a second new box is stacked lower instead of hiding the first');
  const d = duplicateLayer(withA, 'name')!;
  assert.notEqual(d.id, 'name');
  assert.equal(d.content, '{{NAME}}');
  assert.notEqual(d.style.fit, t.layers.find((l) => l.id === 'name')!.style.fit);
  assert.equal(duplicateLayer(withA, 'missing'), null);
});

test('sample rows: longest row, placeholder defaults, row clamping, caret insert, background refs', () => {
  const t = builtinTemplate('classic');
  const rows = [{ NAME: 'Al' }, { NAME: 'Maria Fernanda Gonzalez de la Vega y Montenegro' }, { NAME: 'Bo Li' }];
  assert.equal(longestRowIndex(rows, t), 1);
  assert.equal(sampleValuesFor(['NAME'], [], 0).NAME, 'Ada Lovelace');
  assert.equal(sampleValuesFor(['CUSTOM_FIELD'], [], 0).CUSTOM_FIELD, 'Sample custom_field');
  assert.equal(sampleValuesFor(['NAME'], rows, 99).NAME, 'Bo Li');
  assert.deepEqual(insertAtCaret('Hello world', 6, 11, '{{NAME}}'), { text: 'Hello {{NAME}}', caret: 14 });
  assert.equal(backgroundRefOf({ backgroundRef: 'builtin:gold' }), 'gold');
  assert.equal(backgroundRefOf({ backgroundRef: 'custom:up_x' }), 'up_x');
  assert.equal(backgroundRefOf({}), 'classic');
});
