import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, eq, ok, near } from "./harness.ts";
import { FalClient, readCallLog, loadEnv, asUrl } from "../src/fal.ts";
import { nanoBanana, tripoImageTo3d, elevenSfx, saveOutputs } from "../src/models.ts";

const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "kassets-"));

interface Call {
  url: string;
  method: string;
  body?: unknown;
  auth?: string;
}

/** A fake fal queue: submit -> N polls IN_QUEUE/IN_PROGRESS -> COMPLETED -> result; plus a fake CDN. */
function mockFal(result: unknown, polls = 2, fail?: "submit" | "status") {
  const calls: Call[] = [];
  let n = 0;
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: h.Authorization,
    });
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://queue.fal.run/") && init?.method === "POST") {
      if (fail === "submit") return new Response("bad key", { status: 401 });
      return json({
        request_id: "req-1",
        status_url: "https://q/status/req-1",
        response_url: "https://q/result/req-1",
      });
    }
    if (url === "https://q/status/req-1") {
      if (fail === "status") return json({ status: "FAILED", error: "nope" });
      return json({ status: n++ < polls ? (n === 1 ? "IN_QUEUE" : "IN_PROGRESS") : "COMPLETED" });
    }
    if (url === "https://q/result/req-1") return json(result);
    if (url.startsWith("https://cdn/")) return new Response(new Uint8Array([1, 2, 3, url.length]));
    return new Response("not mocked", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

let clock = 1_700_000_000_000;
const opts = (f: typeof fetch, logFile?: string) => ({
  key: "test-key",
  fetch: f,
  sleep: async () => {
    clock += 3000;
  },
  now: () => clock,
  logFile,
});

test("fal: submit, poll, result, cost log", async () => {
  const dir = tmp();
  const log = join(dir, "calls.log");
  const { f, calls } = mockFal({ images: [{ url: "https://cdn/a.png" }], description: "a sheet" }, 3);
  const fal = new FalClient(opts(f, log));
  const r = await nanoBanana(fal, { prompt: "icons", aspect: "4:3", resolution: "2K", seed: 42, label: "sheet_x" });
  eq(r.urls[0], "https://cdn/a.png");
  eq(r.result.requestId, "req-1");
  eq(calls[0].url, "https://queue.fal.run/fal-ai/nano-banana-pro");
  eq(calls[0].auth, "Key test-key");
  const body = calls[0].body as Record<string, unknown>;
  eq(body.seed, 42, "seed passed through");
  eq(body.aspect_ratio, "4:3");
  eq(calls.filter((c) => c.url.includes("/status/")).length, 4, "polled until COMPLETED");
  near(r.result.cost, 0.15, 1e-9);
  near(r.result.ms, 12000, 1e-9, "duration from the injected clock");
  const line = readFileSync(log, "utf8");
  ok(line.includes("fal-ai/nano-banana-pro sheet_x $0.150 id=req-1 ms=12000"), line);
  const files = await saveOutputs(fal, dir, "sheet_x", "png", r.urls, r.result, r.input);
  ok(existsSync(files[0]));
  const meta = JSON.parse(readFileSync(join(dir, "sheet_x.meta.json"), "utf8"));
  eq(meta.input.seed, 42, "meta records the exact input");
  eq(meta.requestId, "req-1");
});

test("fal: edit endpoint with local references as data URIs; tripo and sfx wrappers", async () => {
  const dir = tmp();
  const ref = join(dir, "ref.png");
  writeFileSync(ref, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const a = mockFal({ images: [{ url: "https://cdn/b.png" }] });
  const fal = new FalClient(opts(a.f, join(dir, "calls.log")));
  await nanoBanana(fal, { prompt: "same style", images: [ref] });
  eq(a.calls[0].url, "https://queue.fal.run/fal-ai/nano-banana-pro/edit");
  const urls = (a.calls[0].body as { image_urls: string[] }).image_urls;
  ok(urls[0].startsWith("data:image/png;base64,"));
  eq(asUrl("https://x/y.png"), "https://x/y.png");
  const t = mockFal({ model_mesh: { url: "https://cdn/m.glb" }, rendered_image: { url: "https://cdn/r.webp" } });
  const m = await tripoImageTo3d(new FalClient(opts(t.f, join(dir, "calls.log"))), { image: ref, faces: 900, seed: 3 });
  eq(m.glb, "https://cdn/m.glb");
  const tb = t.calls[0].body as Record<string, unknown>;
  eq(tb.face_limit, 900);
  eq(tb.model_seed, 3);
  eq(tb.texture, true);
  const s = mockFal({ audio: { url: "https://cdn/s.mp3" } });
  const sfx = await elevenSfx(new FalClient(opts(s.f, join(dir, "calls.log"))), { text: "a gobble", seconds: 2 });
  eq(sfx.url, "https://cdn/s.mp3");
  const total = readCallLog(join(dir, "calls.log"));
  eq(total.entries.length, 3);
  near(total.total, 0.15 + 0.3 + 0.004, 1e-9, "summed estimates");
});

test("fal: errors surface (submit status, failed job), no key, .env loading", async () => {
  const a = mockFal({}, 0, "submit");
  let msg = "";
  await new FalClient(opts(a.f)).run("fal-ai/nano-banana", { prompt: "x" }).catch((e) => (msg = e.message));
  ok(msg.includes("submit 401"), msg);
  const b = mockFal({}, 0, "status");
  msg = "";
  await new FalClient(opts(b.f)).run("fal-ai/nano-banana", { prompt: "x" }).catch((e) => (msg = e.message));
  ok(msg.includes("FAILED"), msg);
  const saved = process.env.FAL_KEY;
  delete process.env.FAL_KEY;
  const dir = tmp();
  let threw = false;
  try {
    new FalClient({ fetch: a.f });
  } catch {
    threw = true;
  }
  ok(threw, "no key throws");
  writeFileSync(join(dir, ".env"), 'FAL_KEY="from-env-file"\n# comment\n');
  eq(loadEnv(join(dir)), join(dir, ".env"));
  eq(new FalClient({ fetch: a.f }).key, "from-env-file");
  if (saved === undefined) delete process.env.FAL_KEY;
  else process.env.FAL_KEY = saved;
});

test("calls.log: reads Grudge's older format too", () => {
  const dir = tmp();
  const f = join(dir, "calls.log");
  writeFileSync(f, "2026-01-01T00:00:00Z fal-ai/nano-banana-pro/edit 2K sheet_boons $0.15\n");
  const r = readCallLog(f);
  eq(r.entries[0].label, "2K sheet_boons");
  near(r.total, 0.15, 1e-9);
});
