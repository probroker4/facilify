import { createCanvas } from '@napi-rs/canvas';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

export interface Raster { width: number; height: number; data: Uint8ClampedArray; png: () => Buffer }

export async function rasterizePdf(pdf: Uint8Array, scale = 1): Promise<Raster> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: pdf.slice(), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  await doc.destroy();
  return { width: canvas.width, height: canvas.height, data: img.data as unknown as Uint8ClampedArray, png: () => canvas.toBuffer('image/png') };
}

export async function pdfTextItems(pdf: Uint8Array): Promise<{ str: string; x: number; y: number; width: number; height: number }[]> {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: pdf.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = (content.items as { str: string; transform: number[]; width: number; height: number }[])
    .filter((i) => typeof i.str === 'string')
    .map((i) => ({ str: i.str, x: i.transform[4], y: vp.height - i.transform[5], width: i.width, height: i.height }));
  await doc.destroy();
  return items;
}
