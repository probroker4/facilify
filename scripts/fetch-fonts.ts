import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_FONTS } from '../src/lib/fonts/catalog';

const OUT = path.join(process.cwd(), 'assets', 'fonts');

const FALLBACK_SUBSETS = ['latin', 'latin-ext', 'vietnamese', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext'];
function subsetsFor(id: string): string[] {
  if (id === 'noto-sans-devanagari') return ['devanagari', 'latin', 'latin-ext'];
  if (id === 'noto-sans' || id === 'noto-serif') return FALLBACK_SUBSETS;
  return ['latin', 'latin-ext'];
}
type Variants = Record<string, Record<string, Record<string, { url: { ttf?: string } }>>>;

async function get(url: string, tries = 4): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404 || i + 1 >= tries) return r;
    } catch (e) { if (i + 1 >= tries) throw e; }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
}

async function main() {
  let files = 0;
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  for (const font of BUNDLED_FONTS) {
    if (only && !only.includes(font.id)) continue;
    const meta = (await (await get(`https://api.fontsource.org/v1/fonts/${font.id}`)).json()) as { subsets: string[]; variants: Variants };
    const subsets = subsetsFor(font.id);
    const wanted: [number, string][] = [[400, 'normal'], [700, 'normal'], [400, 'italic'], [700, 'italic']];
    for (const [w, s] of wanted) {
      for (const subset of subsets) {
        const url = meta.variants?.[String(w)]?.[s]?.[subset]?.url?.ttf;
        if (!url) continue;
        const dest = path.join(OUT, font.id, `${subset}-${w}-${s}.ttf`);
        if (fs.existsSync(dest)) { files++; continue; }
        const res = await get(url);
        if (!res.ok) { console.warn(`skip ${font.id} ${subset}-${w}-${s}: ${res.status}`); continue; }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
        files++;
      }
    }
    fs.mkdirSync(path.join(OUT, font.id), { recursive: true });
    fs.writeFileSync(path.join(OUT, font.id, 'meta.json'), JSON.stringify({ family: font.family, subsets: meta.subsets }));
    process.stdout.write(`${font.id} `);
  }
  console.log(`\nfonts ready: ${files} files in ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
