// Browser screenshot harness (from the many throwaway playwright scripts used on Grudge): system chromium through
// playwright-core, headless, each URL at several viewport sizes; waits for a page predicate (a JS expression, e.g.
// "window.game?.state === 'match' && window.game.world.time > 5") and an optional settle delay, saves PNGs, and
// collects console errors, page errors and failed requests per shot. Most UI bugs shipped were visible in a
// screenshot nobody looked at: take them at several resolutions and look at them.
import { mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface Viewport {
  width: number;
  height: number;
  /** File-name tag (default "1920x1080"). */
  name?: string;
}

/** 1080p, 720p and a 16:10 laptop. */
export const DEFAULT_SIZES: Viewport[] = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
];

export interface ShotTarget {
  name: string;
  url: string;
  /** Overrides the run's waitFor for this URL. */
  waitFor?: string;
}

export interface ShotOptions {
  targets: (ShotTarget | string)[];
  out: string;
  sizes?: Viewport[];
  /** JS expression polled in the page until truthy. */
  waitFor?: string;
  /** Extra ms after the predicate (let animations / particles settle). */
  settleMs?: number;
  timeoutMs?: number;
  /** Chromium binary (default $CHROMIUM, then /usr/bin/chromium, chromium-browser, google-chrome). */
  chromium?: string;
  /** Extra browser args (WebGL in headless: --use-angle=swiftshader is the safe default; --ignore-gpu-blocklist). */
  args?: string[];
  deviceScaleFactor?: number;
  fullPage?: boolean;
  /** Ignore console messages matching these. */
  ignore?: RegExp[];
  log?: (msg: string) => void;
}

export interface ShotProblem {
  target: string;
  size: string;
  kind: "console" | "pageerror" | "requestfailed" | "timeout";
  message: string;
}

export interface ShotReport {
  files: string[];
  problems: ShotProblem[];
}

export function findChromium(): string {
  const c = [process.env.CHROMIUM, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"];
  const hit = c.find((p) => p && existsSync(p));
  if (!hit) throw new Error("no chromium found (set CHROMIUM)");
  return hit;
}

const slug = (s: string) => s.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "page";

export async function screenshots(o: ShotOptions): Promise<ShotReport> {
  const { chromium } = await import("playwright-core");
  mkdirSync(o.out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: o.chromium ?? findChromium(),
    args: o.args ?? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const files: string[] = [];
  const problems: ShotProblem[] = [];
  try {
    for (const t of o.targets) {
      const target: ShotTarget = typeof t === "string" ? { name: slug(t.replace(/^\w+:\/\//, "")), url: t } : t;
      for (const vp of o.sizes ?? DEFAULT_SIZES) {
        const size = vp.name ?? `${vp.width}x${vp.height}`;
        const page = await browser.newPage({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: o.deviceScaleFactor ?? 1,
        });
        const note = (kind: ShotProblem["kind"], message: string) => {
          if (o.ignore?.some((re) => re.test(message))) return;
          problems.push({ target: target.name, size, kind, message });
        };
        page.on("console", (m) => {
          if (m.type() === "error") note("console", m.text());
        });
        page.on("pageerror", (e) => note("pageerror", e.message));
        page.on("requestfailed", (r) => note("requestfailed", `${r.url()} ${r.failure()?.errorText ?? ""}`));
        const timeout = o.timeoutMs ?? 60_000;
        try {
          await page.goto(target.url, { timeout, waitUntil: "load" });
          const wait = target.waitFor ?? o.waitFor;
          if (wait) await page.waitForFunction(wait, null, { timeout });
          if (o.settleMs) await page.waitForTimeout(o.settleMs);
        } catch (e) {
          note("timeout", (e as Error).message.split("\n")[0]);
        }
        const file = join(o.out, `${slug(target.name)}_${size}.png`);
        await page.screenshot({ path: file, fullPage: o.fullPage ?? false });
        files.push(file);
        o.log?.(`shot ${file}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { files, problems };
}
