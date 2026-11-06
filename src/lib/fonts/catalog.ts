import { levenshtein, normKey } from '@/lib/text';

export type CatalogSource = 'google' | 'fontsource' | 'bundled';

export function fontIdFromFamily(family: string): string {
  return family.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export interface CatalogFont {
  id: string;
  family: string;
  category: string;
  subsets: string[];
  weights: number[];
  styles: string[];
  source?: 'google' | 'fontsource' | 'bundled';
  popularity?: number;
  bundled?: boolean;
}

export const BUNDLED_FONTS: CatalogFont[] = [
  ['noto-sans', 'Noto Sans', 'sans-serif'], ['noto-serif', 'Noto Serif', 'serif'], ['noto-sans-devanagari', 'Noto Sans Devanagari', 'sans-serif'],
  ['playfair-display', 'Playfair Display', 'serif'], ['great-vibes', 'Great Vibes', 'handwriting'], ['montserrat', 'Montserrat', 'sans-serif'],
  ['lato', 'Lato', 'sans-serif'], ['roboto', 'Roboto', 'sans-serif'], ['open-sans', 'Open Sans', 'sans-serif'],
  ['merriweather', 'Merriweather', 'serif'], ['cinzel', 'Cinzel', 'serif'], ['dancing-script', 'Dancing Script', 'handwriting'],
  ['eb-garamond', 'EB Garamond', 'serif'], ['poppins', 'Poppins', 'sans-serif'], ['raleway', 'Raleway', 'sans-serif'],
  ['lora', 'Lora', 'serif'], ['pinyon-script', 'Pinyon Script', 'handwriting'], ['cormorant-garamond', 'Cormorant Garamond', 'serif'],
  ['libre-baskerville', 'Libre Baskerville', 'serif'], ['oswald', 'Oswald', 'sans-serif'], ['alex-brush', 'Alex Brush', 'handwriting'],
  ['parisienne', 'Parisienne', 'handwriting'], ['sacramento', 'Sacramento', 'handwriting'], ['italianno', 'Italianno', 'handwriting'],
  ['josefin-sans', 'Josefin Sans', 'sans-serif'], ['nunito', 'Nunito', 'sans-serif'], ['work-sans', 'Work Sans', 'sans-serif'],
  ['pt-serif', 'PT Serif', 'serif'], ['crimson-text', 'Crimson Text', 'serif'], ['abril-fatface', 'Abril Fatface', 'display'],
].map(([id, family, category], i) => ({
  id, family, category, subsets: id === 'noto-sans-devanagari' ? ['devanagari', 'latin', 'latin-ext'] : ['latin', 'latin-ext'],
  weights: [400, 700], styles: ['normal', 'italic'], bundled: true, source: 'bundled' as const, popularity: i + 1,
}));

export function searchFonts(query: string, catalog: CatalogFont[], limit = 40): CatalogFont[] {
  const q = normKey(query);
  if (!q) return catalog.slice(0, limit);
  const scored: { f: CatalogFont; s: number }[] = [];
  for (const f of catalog) {
    const fam = normKey(f.family);
    const words = f.family.toLowerCase().split(/\s+/).map(normKey);
    let s = 0;
    if (fam.startsWith(q)) s = 80 + (fam === q ? 2 : 0) - Math.min(20, fam.length - q.length) * 0.5;
    else if (words.some((w) => w.startsWith(q))) s = 60;
    else if (fam.includes(q)) s = 40;
    if (!s) continue;
    if (f.bundled) s += 12;
    if (f.popularity) s += 10 * (1 - Math.min(f.popularity, 1000) / 1000);
    scored.push({ f, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.f.family.localeCompare(b.f.family)).slice(0, limit).map((x) => x.f);
}

const ALIASES: [RegExp, string[]][] = [
  [/^(helvetica|arial|arialmt|arialnarrow)/, ['Arimo', 'Roboto', 'Open Sans']],
  [/^(times|timesnewroman|timesnewromanps)/, ['Tinos', 'Noto Serif', 'Merriweather']],
  [/^(courier|couriernew)/, ['Cousine', 'Roboto Mono']],
  [/^(calibri)/, ['Carlito', 'Lato']],
  [/^(cambria)/, ['Caladea', 'Noto Serif']],
  [/^(georgia)/, ['Gelasio', 'Lora']],
  [/^(verdana|tahoma|segoeui)/, ['Open Sans', 'Noto Sans']],
  [/^(garamond|adobegaramond)/, ['EB Garamond']],
  [/^(palatino|bookantiqua|palatinolinotype)/, ['EB Garamond', 'Libre Baskerville']],
  [/^(baskerville)/, ['Libre Baskerville']],
  [/^(didot|bodoni)/, ['Playfair Display', 'Libre Bodoni']],
  [/^(futura)/, ['Jost', 'Montserrat']],
  [/^(gillsans)/, ['Lato', 'Cabin']],
  [/^(optima)/, ['Marcellus', 'Lato']],
  [/^(trajan)/, ['Cinzel']],
  [/^(brushscript|snellroundhand|zapfchancery)/, ['Great Vibes', 'Dancing Script']],
  [/^(lucidahandwriting|segoescript)/, ['Dancing Script', 'Parisienne']],
];

export interface FontSuggestion {
  pdfName: string;
  family: string;
  match: CatalogFont | null;
  bold: boolean;
  italic: boolean;
  how: 'exact' | 'alias' | 'close' | 'none';
}

export function suggestFromPdfFontNames(names: string[], catalog: CatalogFont[]): FontSuggestion[] {
  const out: FontSuggestion[] = [];
  const seen = new Set<string>();
  const byKey = new Map<string, CatalogFont>();
  for (const f of [...catalog].sort((a, b) => Number(!!b.bundled) - Number(!!a.bundled) || (a.popularity ?? 1e9) - (b.popularity ?? 1e9))) {
    const k = normKey(f.family);
    if (!byKey.has(k)) byKey.set(k, f);
  }
  for (const raw of names) {
    const noSubset = raw.replace(/^[A-Z]{6}\+/, '');
    const [famPart, ...styleParts] = noSubset.split(/[-,]/);
    const stylePart = styleParts.join('-');
    const family = famPart.replace(/(MT|PS|Std|Pro|LT|OTF|TT)$/g, '').replace(/([a-z\d])([A-Z])/g, '$1 $2').trim();
    const key = normKey(family);
    if (!key || seen.has(key + stylePart)) continue;
    seen.add(key + stylePart);
    const bold = /bold|black|heavy|semibold|demi/i.test(stylePart) || /bold$/i.test(famPart);
    const italic = /italic|oblique|ital$/i.test(stylePart);
    let match: CatalogFont | null = byKey.get(key) ?? null;
    let how: FontSuggestion['how'] = match ? 'exact' : 'none';
    if (!match) {
      const alias = ALIASES.find(([re]) => re.test(key));
      for (const fam of alias?.[1] ?? []) {
        const hit = byKey.get(normKey(fam));
        if (hit) { match = hit; how = 'alias'; break; }
      }
      if (match) how = 'alias';
    }
    if (!match && key.length >= 4) {
      let best: { f: CatalogFont; d: number; len: number } | null = null;
      for (const [k, f] of byKey) {
        if (k.length < 4) continue;
        const d = key.startsWith(k) ? 0 : k.startsWith(key) ? 0.5 : levenshtein(key, k);
        if (d > (key.length >= 8 ? 2 : 1)) continue;
        const better = !best || d < best.d || (d === best.d && (d === 0 ? k.length > best.len : k.length < best.len));
        if (better) best = { f, d, len: k.length };
      }
      if (best) { match = best.f; how = 'close'; }
    }
    out.push({ pdfName: raw, family, match, bold, italic, how });
  }
  return out;
}
