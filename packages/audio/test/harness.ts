// Tiny assert runner (no test framework dependency).
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
