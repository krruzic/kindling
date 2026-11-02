// Tiny test runner (no framework): test(name, fn) registers, run() executes in order and exits non-zero on failure.
type Fn = () => void | Promise<void>;
const tests: { name: string; fn: Fn }[] = [];

export function test(name: string, fn: Fn): void {
  tests.push({ name, fn });
}

export function ok(cond: unknown, msg = "expected truthy"): asserts cond {
  if (!cond) throw new Error(msg);
}

export function eq<T>(a: T, b: T, msg = ""): void {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg ? msg + ": " : ""}expected ${sb}, got ${sa}`);
}

export async function run(): Promise<void> {
  let failed = 0;
  for (const t of tests) {
    const t0 = performance.now();
    try {
      await t.fn();
      console.log(`  ok   ${t.name} (${Math.round(performance.now() - t0)} ms)`);
    } catch (e) {
      failed++;
      console.log(`  FAIL ${t.name}\n       ${(e as Error).stack ?? e}`);
    }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exit(1);
}
