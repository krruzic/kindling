// Tiny test runner: test() registers, run() executes in order and reports. No framework dependency.
const tests: { name: string; fn: () => void | Promise<void> }[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
  tests.push({ name, fn });
}

export function eq<T>(got: T, want: T, msg = ""): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) throw new Error(`${msg ? msg + ": " : ""}got ${g}, want ${w}`);
}

export function ok(cond: unknown, msg = "expected true"): void {
  if (!cond) throw new Error(msg);
}

export function near(got: number, want: number, eps = 1e-6, msg = ""): void {
  if (Math.abs(got - want) > eps) throw new Error(`${msg ? msg + ": " : ""}got ${got}, want ~${want}`);
}

export async function run(): Promise<number> {
  let fails = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`ok   ${t.name}`);
    } catch (e) {
      fails++;
      console.log(`FAIL ${t.name}\n     ${(e as Error).message}`);
    }
  }
  console.log(fails ? `${fails} of ${tests.length} FAILED` : `all ${tests.length} passed`);
  return fails;
}
