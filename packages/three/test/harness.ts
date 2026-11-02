// Tiny test runner: test() registers a case, run() executes them in order and exits non-zero on any failure.
type Case = { name: string; fn: () => void | Promise<void> };
const cases: Case[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  cases.push({ name, fn });
}

export function ok(v: unknown, msg = "expected truthy"): asserts v {
  if (!v) throw new Error(msg);
}

export function eq<T>(a: T, b: T, msg = ""): void {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

export function near(a: number, b: number, eps = 1e-6, msg = ""): void {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg} expected ${b} ± ${eps}, got ${a}`);
}

export async function run(): Promise<void> {
  let failed = 0;
  for (const c of cases) {
    const t0 = performance.now();
    try {
      await c.fn();
      console.log(`ok   ${c.name} (${(performance.now() - t0).toFixed(0)} ms)`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${c.name}\n     ${(e as Error).stack ?? e}`);
    }
  }
  console.log(`${cases.length - failed}/${cases.length} passed`);
  if (failed) process.exit(1);
}
