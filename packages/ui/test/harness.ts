// Tiny assert runner (no test framework dependency) plus fakes shared by the UI tests: a monospace measure
// function, a fake 2D context / canvas that records calls, and a fake Font.
import type { Font } from "../src/font/font.ts";
import type { Theme, Ui } from "../src/theme.ts";

const tests: { name: string; fn: () => void | Promise<void> }[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

export function ok(v: unknown, msg = "expected truthy"): void {
  if (!v) throw new Error(msg);
}

export function eq<T>(a: T, b: T, msg = ""): void {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg} expected ${sb}, got ${sa}`);
}

export function near(a: number, b: number, eps = 1e-6, msg = ""): void {
  if (Math.abs(a - b) > eps) throw new Error(`${msg} expected ~${b}, got ${a}`);
}

export async function run(): Promise<void> {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ok   ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${t.name}\n       ${(e as Error).message}`);
    }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
}

/** Monospace: every character is 0.6 em wide, "W" is 1 em (so fits are easy to reason about). */
export const mono = (s: string, size: number) => [...s].reduce((a, c) => a + (c === "W" ? 1 : 0.6), 0) * size;

export interface FakeCtx {
  calls: string[];
  globalAlpha: number;
  imageSmoothingEnabled: boolean;
  m: { a: number; b: number; c: number; d: number; e: number; f: number };
}

/** A recording stand-in for CanvasRenderingContext2D (enough for memo, plates, debug, components). */
export function fakeCtx(scale = 1): CanvasRenderingContext2D & FakeCtx {
  const stack: FakeCtx["m"][] = [];
  const ctx = {
    calls: [] as string[],
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    m: { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 },
    getTransform() {
      return { ...this.m };
    },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      this.m = { a, b, c, d, e, f };
    },
    translate(x: number, y: number) {
      this.m.e += this.m.a * x + this.m.c * y;
      this.m.f += this.m.b * x + this.m.d * y;
    },
    scale(x: number, y: number) {
      this.m.a *= x;
      this.m.b *= x;
      this.m.c *= y;
      this.m.d *= y;
    },
    save() {
      stack.push({ ...this.m });
    },
    restore() {
      this.m = stack.pop() ?? this.m;
    },
    drawImage(..._a: unknown[]) {
      this.calls.push("drawImage");
    },
    clearRect() {
      this.calls.push("clearRect");
    },
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    roundRect() {},
    fill() {},
    stroke() {},
    arc() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    rotate() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
  };
  return ctx as unknown as CanvasRenderingContext2D & FakeCtx;
}

export function fakeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = { width: w, height: h, ctx: fakeCtx(), getContext: () => c.ctx };
  return c as unknown as HTMLCanvasElement;
}

/** A Font over the mono measure that records what it drew. */
export function fakeFont(drawn: string[] = []): Font {
  return {
    name: "fake",
    measure: mono,
    lineHeight: (s) => s * 1.2,
    draw: (_c, s) => void drawn.push(s),
    ready: () => true,
  };
}

export function fakeTheme(font = fakeFont()): Theme {
  const c = "#fff";
  return {
    name: "fake",
    font,
    colors: {
      text: c,
      dim: c,
      accent: c,
      panelText: c,
      panelDim: c,
      selected: c,
      disabled: c,
      ink: c,
      warn: c,
      good: c,
      track: c,
      fill: c,
    },
    metrics: { text: 10, small: 8, title: 16, minText: 6, rowH: 16, pad: 4, gap: 3, glyph: 10 },
    textStyle: {},
    panelTextStyle: {},
    panels: {},
    cursor: () => {},
  };
}

export function fakeUi(theme = fakeTheme()): Ui {
  return { ctx: fakeCtx(), theme, time: 0 };
}
