import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { rankFonts, shapeFromRegion, templatePixels, type Candidate } from '../../src/lib/fonts/identify';
import { BUNDLED_FONTS } from '../../src/lib/fonts/catalog';
import { ownLatinFace } from '../../src/lib/fonts/server';

let checks = 0;
const ok = (c: boolean, m: string) => { if (!c) { console.error(`FAIL: ${m}`); process.exit(1); } checks++; console.log(`  ok ${m}`); };

async function register(id: string, bold = false): Promise<string> {
  const face = await ownLatinFace(id, bold);
  if (!face) throw new Error(`font ${id} missing from assets/fonts`);
  const alias = `testfont_${id}_${bold ? 'b' : 'r'}`;
  GlobalFonts.register(Buffer.from(face.bytes), alias);
  return alias;
}

async function template(opts: { fontId: string; bold?: boolean; text: string; paper: string; ink: string; size: number }) {
  const alias = await register(opts.fontId, opts.bold);
  const W = 1400, H = 990, c = createCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = opts.paper; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = opts.ink; ctx.lineWidth = 10; ctx.strokeRect(40, 40, W - 80, H - 80);
  ctx.fillStyle = opts.ink; ctx.font = `${opts.size}px "${alias}"`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(opts.text, W / 2, 480);
  const m = ctx.measureText(opts.text);
  const box = { x: (W / 2 - m.width / 2 - 30) / W, y: (480 - opts.size * 1.05) / H, w: (m.width + 60) / W, h: (opts.size * 1.5) / H };
  return { png: c.toBuffer('image/png'), box };
}

const CANDIDATES: Candidate[] = BUNDLED_FONTS.filter((f) => f.id !== 'noto-sans-devanagari').map((f) => ({ id: f.id, family: f.family, category: f.category }));
const load = async (id: string, bold: boolean) => { const f = await ownLatinFace(id, bold); return f && f.label.startsWith(`${id}/`) ? { bytes: f.bytes, label: f.label } : null; };

async function detect(t: Awaited<ReturnType<typeof template>>, typed: string) {
  const px = await templatePixels(t.png, 'png');
  const sample = shapeFromRegion(px, t.box);
  if (!sample) throw new Error('no ink found in the box');
  return rankFonts(sample, typed, CANDIDATES, load, { deadlineMs: 120_000 });
}

async function main() {
  const cases: { name: string; fontId: string; bold?: boolean; text: string; typed?: string; paper: string; ink: string; size: number; top: number }[] = [
    { name: 'Playfair Display on cream, navy ink', fontId: 'playfair-display', text: 'Certificate of Achievement', paper: '#fbf8f1', ink: '#1f3a5f', size: 90, top: 1 },
    { name: 'Great Vibes script', fontId: 'great-vibes', text: 'Presented to Ada Lovelace', paper: '#ffffff', ink: '#7a1f1f', size: 100, top: 1 },
    { name: 'Montserrat bold on white', fontId: 'montserrat', bold: true, text: 'WINNER OF THE HACKATHON', paper: '#ffffff', ink: '#0f172a', size: 60, top: 1 },
    { name: 'Cinzel on teal (light text on dark paper)', fontId: 'cinzel', text: 'Certificate of Excellence', paper: '#0f4c5c', ink: '#f5e6c8', size: 84, top: 1 },
    { name: 'Lora with different typed spacing', fontId: 'lora', text: 'For outstanding teamwork', typed: 'For outstanding   teamwork', paper: '#fffdf6', ink: '#3b2f1e', size: 88, top: 2 },
    { name: 'Dancing Script', fontId: 'dancing-script', text: 'Congratulations', paper: '#f7fbff', ink: '#1e1b4b', size: 110, top: 1 },
  ];
  for (const c of cases) {
    const t = await template(c);
    const { matches, searched } = await detect(t, (c.typed ?? c.text).replace(/\s+/g, ' ').trim());
    const rank = matches.findIndex((m) => m.id === c.fontId) + 1;
    console.log(`  ${c.name}: top 3 = ${matches.slice(0, 3).map((m) => `${m.id} ${Math.round(m.score * 100)}`).join(', ')} (searched ${searched})`);
    ok(rank >= 1 && rank <= c.top, `${c.name}: the right font ranks #${rank} (needed top ${c.top})`);
  }
  const blank = await template({ fontId: 'lora', text: 'x', paper: '#ffffff', ink: '#ffffff', size: 40 });
  const px = await templatePixels(blank.png, 'png');
  ok(shapeFromRegion(px, { x: 0.3, y: 0.7, w: 0.3, h: 0.1 }) === null, 'an empty box is refused instead of guessed');
  console.log(`${checks} checks passed`);
  console.log('FONT DETECT OK');
}
main().catch((e) => { console.error(e); process.exit(1); });
