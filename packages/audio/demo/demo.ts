// @kindling/audio demo: samples are synthesised into AudioBuffers at unlock (no asset files), then every engine
// feature has a button: variants with jitter, the voice budget under a burst, priority, loops with and without a
// duration, synth blips, ducking, ambience beds + a positional emitter, and music crossfading between two
// generated tracks. Click the split-screen strip to place a sound: it pans by which view hears it.
import { Ambience, AudioEngine, MusicPlayer, place, type Hearing } from "../src/index.ts";

const a = new AudioEngine({ maxVoices: 24 });
const amb = new Ambience(a);
let music: MusicPlayer | null = null;

function buffer(dur: number, fn: (t: number, i: number) => number): AudioBuffer {
  const c = a.ctx!;
  const b = c.createBuffer(1, Math.round(dur * c.sampleRate), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = fn(i / c.sampleRate, i);
  return b;
}

const env = (t: number, k: number) => Math.exp(-t * k);

function synthesise(): void {
  const bank = a.bank;
  for (const f of [180, 210, 240])
    bank.add(
      "hit",
      buffer(0.25, (t) => (Math.sin(2 * Math.PI * f * t * (1 - t)) + (Math.random() * 2 - 1) * 0.5) * env(t, 18)),
    );
  for (const f of [880, 990])
    bank.add(
      "coin",
      buffer(0.3, (t) => Math.sign(Math.sin(2 * Math.PI * (t < 0.06 ? f : f * 1.5) * t)) * 0.3 * env(t, 9)),
    );
  bank.add(
    "static",
    buffer(0.5, () => (Math.random() * 2 - 1) * 0.25),
  );
  let lp = 0;
  bank.add(
    "bed.wind",
    buffer(4, (t) => (lp += ((Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(t * 1.6)) - lp) * 0.02) * 3),
  );
  bank.add(
    "bed.fire",
    buffer(2, () => (Math.random() < 0.002 ? 0.8 : 0) + (Math.random() * 2 - 1) * 0.05),
  );
  const track = (root: number, len: number) => {
    const notes = [0, 3, 7, 10, 12, 10, 7, 3].map((s) => root * Math.pow(2, s / 12));
    const step = len / 16;
    return buffer(len, (t) => {
      const k = Math.floor(t / step);
      const tt = t - k * step;
      const n = notes[k % notes.length];
      return (Math.sin(2 * Math.PI * n * t) * 0.25 + Math.sin(2 * Math.PI * (root / 2) * t) * 0.15) * env(tt, 6);
    });
  };
  const tracks = { calm: track(220, 4), battle: track(330, 3) };
  music = new MusicPlayer(
    a,
    { calm: { url: "calm" }, battle: { url: "battle" } },
    { load: async (u) => tracks[u as "calm"] },
  );
}

const hearing: Hearing = {
  views: [
    { x: 0, z: 0, range: 50, left: 0, span: 0.5 },
    { x: 100, z: 0, range: 50, left: 0.5, span: 0.5 },
  ],
};

const status = document.getElementById("status")!;
const actions: Record<string, () => void> = {
  hit: () => a.play("hit", 0.8),
  burst: () => {
    for (let i = 0; i < 60; i++) a.play("hit", 0.25, { at: i * 0.01 });
  },
  priority: () => a.play("coin", 0.7, { priority: true, jitter: 0 }),
  loopDur: () => a.play("static", 0.4, { loop: true, dur: 2 }),
  loopOpen: () => a.play("static", 0.25, { loop: true }),
  stopLoops: () => a.stopLoops(),
  blip: () => {
    a.tone({ from: 520, dur: 0.08, gain: 0.1 });
    a.tone({ from: 780, dur: 0.12, gain: 0.1, at: 0.08 });
  },
  whoosh: () => a.hiss({ freq: 400, q: 2, dur: 0.6, gain: 0.4, filter: "bandpass", sweepTo: 4000 }),
  duck: () => a.duck(["music", "ambience"], 0.3),
  beds: () => amb.setBeds([{ id: "bed.wind", level: 0.9 }]),
  quiet: () => amb.stop(),
  calm: () => music?.set("calm"),
  battle: () => music?.set("battle"),
  musicOff: () => music?.set(null),
};
for (const [k, f] of Object.entries(actions))
  document.querySelector(`[data-a="${k}"]`)?.addEventListener("click", () => {
    a.unlock();
    if (!music) synthesise();
    f();
  });
for (const k of ["sfx", "music", "ambience"]) {
  const el = document.querySelector<HTMLInputElement>(`[data-level="${k}"]`)!;
  el.addEventListener("input", () => a.setLevel(k, Number(el.value)));
}

const strip = document.getElementById("strip") as HTMLCanvasElement;
const g = strip.getContext("2d")!;
let mark: { x: number; t: number } | null = null;
strip.addEventListener("click", (e) => {
  a.unlock();
  if (!music) synthesise();
  const r = strip.getBoundingClientRect();
  const wx = ((e.clientX - r.left) / r.width) * 200 - 50;
  mark = { x: (e.clientX - r.left) / r.width, t: performance.now() };
  a.play("hit", 1, { place: place(hearing, wx, 0, 0) });
});

function frame(): void {
  a.frame();
  music?.update();
  if (a.ready) amb.emitter("fire", "bed.fire", 0.6, [{ x: 100, z: 0 }], hearing);
  status.textContent = `voices ${a.voices}/${a.maxVoices} · music ${music?.current ?? "-"} · loops ${amb.loops} · ${a.ready ? "running" : "click anything to unlock"}`;
  g.clearRect(0, 0, strip.width, strip.height);
  g.fillStyle = "#1c2a3a";
  g.fillRect(0, 0, strip.width / 2 - 2, strip.height);
  g.fillStyle = "#3a1c1c";
  g.fillRect(strip.width / 2 + 2, 0, strip.width / 2 - 2, strip.height);
  g.fillStyle = "#e8c860";
  g.font = "14px sans-serif";
  g.fillText("P1 VIEW (listener at x=0)", 10, 20);
  g.fillText("P2 VIEW (listener at x=100, a torch loop)", strip.width / 2 + 12, 20);
  if (mark && performance.now() - mark.t < 600) {
    g.beginPath();
    g.arc(mark.x * strip.width, strip.height / 2, 10 + (performance.now() - mark.t) / 20, 0, Math.PI * 2);
    g.strokeStyle = "#fff";
    g.stroke();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
