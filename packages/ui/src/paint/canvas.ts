// Offscreen canvas helpers shared by fonts, plates and memo panels.
//
// Static cached art (baked text, plates, textures) goes in CPU-backed canvases (`willReadFrequently`): painted
// once, then only drawn from, so no GPU surface or flush per cache entry. Canvases redrawn at runtime (memo
// panels) are plain GPU canvases. Never fill the main UI canvas with an image pattern: Chrome then demotes it to
// software raster for good; patterns are only used inside bakes into cache canvases.

export type CanvasFactory = (w: number, h: number) => HTMLCanvasElement;

/** A CPU-backed 2D canvas for static cached art. */
export function cacheCanvas(w = 1, h = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d", { willReadFrequently: true });
  return c;
}

/** A regular (GPU-backed) canvas for content redrawn at runtime. */
export function liveCanvas(w = 1, h = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Device pixels per layout unit of a context's current transform. */
export function deviceScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b) || 1;
}

/** Loads an image and waits for it to decode. */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const im = new Image();
  im.src = url;
  await im.decode();
  return im;
}
