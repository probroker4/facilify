export interface FontFace {
  bytes: Uint8Array;
  synthBold: boolean;
  synthItalic: boolean;
  label: string;
}

export interface FontProvider {
  getFaces(fontId: string, bold: boolean, italic: boolean): Promise<FontFace[]>;
}

export const FALLBACK_FONT_IDS = ['noto-sans', 'noto-sans-devanagari'];
export const PRIMARY_SUBSETS = ['latin', 'latin-ext', 'devanagari', 'cyrillic', 'greek', 'vietnamese'];
export const FALLBACK_SUBSETS = ['latin', 'latin-ext', 'devanagari', 'vietnamese', 'cyrillic', 'cyrillic-ext', 'greek', 'greek-ext'];
