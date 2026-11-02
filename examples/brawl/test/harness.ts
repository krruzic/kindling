// Tiny test runner: test(name, fn) registers, run() executes in order and exits non-zero on any failure.
import assert from "node:assert/strict";

export { assert };

const tests: [string, () => unknown][] = [];

export function test(name: string, fn: () => unknown): void {
  tests.push([name, fn]);
}

export async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exitCode = 1;
}
