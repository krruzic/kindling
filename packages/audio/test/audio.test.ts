// Audio engine tests against a fake AudioContext: voice budget and priority stealing, loop stop scheduling (the
// Ceefax bug), bus routing and levels, spatial placement, ducking, the sample bank, ambience and music crossfade.
import { Ambience } from "../src/ambience.ts";
import { SampleBank, groupVariants } from "../src/bank.ts";
import { AudioEngine } from "../src/engine.ts";
import { MusicPlayer } from "../src/music.ts";
import { lean, place, type Hearing } from "../src/spatial.ts";
import { FakeBuffer, FakeContext, FakeGain, FakeMedia, FakeNode, FakeSource, asBuf, asCtx } from "./fakeAudio.ts";
import { eq, near, ok, test } from "./harness.ts";

function engine(o: { maxVoices?: number } = {}) {
  const fc = new FakeContext();
  let r = 0;
  const a = new AudioEngine({
    createContext: () => asCtx(fc),
    maxVoices: o.maxVoices,
    rng: () => (r = (r * 9301 + 49297) % 233280) / 233280,
  });
  a.unlock();
  a.bank.add("hit", asBuf(new FakeBuffer(0.4)));
  a.bank.add("bed", asBuf(new FakeBuffer(3)));
  return { a, fc };
}

const srcOf = (fc: FakeContext) => fc.sources.filter((s) => s.kind === "source" && s.buffer && s.buffer.duration !== 1);

test("bank: variants grouped by id, never the same twice in a row", () => {
  const g = groupVariants(["sfx/hit.0.ogg", "sfx/hit.1.ogg", "sfx/hit.2.ogg", "sfx/bed.wind.ogg"]);
  eq([...g.keys()], ["hit", "bed.wind"]);
  eq(g.get("hit")!.length, 3);
  let x = 0;
  const bank = new SampleBank({ rng: () => (x = (x + 0.37) % 1) });
  const bufs = [1, 2, 3].map((d) => asBuf(new FakeBuffer(d)));
  bufs.forEach((b) => bank.add("hit", b));
  let prev: AudioBuffer | null = null;
  for (let i = 0; i < 50; i++) {
    const b = bank.pick("hit");
    ok(b !== prev, "repeat");
    prev = b;
  }
  eq(bank.pick("nope"), null);
  eq(bank.missing.get("nope"), 1);
});

test("bank: load decodes registered urls, beds last, failures skipped", async () => {
  const order: string[] = [];
  const bank = new SampleBank({
    concurrency: 1,
    fetchBuffer: async (_c, url) => {
      order.push(url);
      if (url.includes("broken")) throw new Error("404");
      return asBuf(new FakeBuffer(1));
    },
  });
  bank.register(groupVariants(["bed.wind.ogg", "hit.0.ogg", "hit.1.ogg", "broken.ogg"]));
  await bank.load(asCtx(new FakeContext()));
  eq(order[order.length - 1], "bed.wind.ogg");
  eq(bank.variants("hit"), 2);
  ok(!bank.has("broken"));
});

test("routing: buses hang off master; ambience under sfx; levels use the squared curve", () => {
  const { a, fc } = engine();
  const dest = fc.destination;
  for (const b of ["sfx", "music", "ambience"]) ok((a.bus(b) as unknown as FakeGain).reaches(dest), b);
  ok((a.bus("ambience") as unknown as FakeGain).reaches(a.bus("sfx") as unknown as FakeGain), "ambience -> sfx");
  ok(!(a.bus("music") as unknown as FakeGain).reaches(a.bus("sfx") as unknown as FakeGain), "music not under sfx");
  a.setLevel("music", 0.5);
  near((a.bus("music") as unknown as FakeGain).gain.value, 0.25);
  a.setLevel("sfx", 0.8);
  near((a.bus("sfx") as unknown as FakeGain).gain.value, 0.64);
  // ambience trims 0.28 of its own level
  near((a.bus("ambience") as unknown as FakeGain).gain.value, 0.28);
});

test("routing: play goes to its bus through placement (gain -> lowpass -> pan)", () => {
  const { a, fc } = engine();
  const v = a.play("hit", 0.5, { bus: "ambience", place: { gain: 0.5, pan: -0.4, muffle: true } })!;
  ok(v);
  const g = v.gain as unknown as FakeGain;
  eq(g.path().slice(0, 3), ["gain", "filter", "pan"]);
  ok(g.reaches(a.bus("ambience") as unknown as FakeGain));
  near(g.gain.value, 0.25);
  const plain = a.play("hit", 1)!;
  ok((plain.gain as unknown as FakeGain).out[0] === (a.bus("sfx") as unknown as FakeGain), "unplaced: straight to sfx");
  ok(srcOf(fc).length === 2);
});

test("voices: budget drops plain sounds, priority true always plays, numeric priority steals", () => {
  const { a, fc } = engine({ maxVoices: 3 });
  ok(a.play("hit", 1, { priority: 1 }));
  ok(a.play("hit", 1));
  ok(a.play("hit", 1));
  eq(a.voices, 3);
  eq(a.play("hit", 1), null, "full: dropped");
  const stolen = a.play("hit", 1, { priority: 2 });
  ok(stolen, "steals a priority-0 voice");
  eq(a.voices, 3);
  const victims = srcOf(fc).filter((s) => s.stopAt !== null);
  eq(victims.length, 1);
  ok(a.play("hit", 1, { priority: 1 }), "steals the last priority-0 voice");
  eq(a.play("hit", 1, { priority: 1 }), null, "nothing below priority 1 left to steal");
  ok(a.play("hit", 1, { priority: true }), "priority true exceeds the budget");
  eq(a.voices, 4);
  fc.advance(5);
  eq(a.voices, 0, "ended voices are released");
});

test("voices: silent or missing sounds don't take a voice", () => {
  const { a } = engine();
  eq(a.play("hit", 0), null);
  eq(a.play("missing", 1), null);
  eq(a.voices, 0);
  eq(a.log.get("missing"), 1000);
});

test("loops: a looped sound with a duration ALWAYS gets its stop (even longer than the sample)", () => {
  const { a, fc } = engine();
  a.play("hit", 1, { loop: true, dur: 2.5, jitter: 0 });
  const s = srcOf(fc)[0];
  ok(s.loop);
  near(s.stopAt!, 2.52, 1e-9);
  const g = s.out[0] as FakeGain;
  ok(
    g.gain.events.some(([k, v, t]) => k === "linear" && v === 0 && Math.abs(t! - 2.5) < 1e-9),
    "fades to 0 at dur",
  );
  fc.advance(3);
  ok(s.ended);
  eq(fc.endless.length, 0);
});

test("loops: one-shot longer than dur is cut; shorter than dur ends naturally; open loops stop on stopLoops", () => {
  const { a, fc } = engine();
  a.play("bed", 1, { dur: 1, jitter: 0 });
  a.play("hit", 1, { dur: 2, jitter: 0 });
  const [bed, hit] = srcOf(fc);
  near(bed.stopAt!, 1.02, 1e-9);
  eq(hit.stopAt, null, "natural end, no stop needed");
  const open = a.play("bed", 1, { loop: true })!;
  eq(open.endsAt, Infinity);
  eq(fc.endless.length, 1);
  a.stopLoops(0.2);
  eq(fc.endless.length, 0);
  fc.advance(10);
  eq(a.voices, 0);
});

test("voice.stop fades and is idempotent", () => {
  const { a, fc } = engine();
  const v = a.play("bed", 1, { loop: true })!;
  fc.currentTime = 1;
  v.stop(0.5);
  v.stop(0.5);
  const s = srcOf(fc)[0];
  near(s.stopAt!, 1.51, 1e-9);
  eq(a.voices, 0);
});

test("synth: tone and hiss schedule their stops", () => {
  const { a, fc } = engine();
  a.tone({ from: 660, to: 440, dur: 0.1, gain: 0.1 });
  a.hiss({ freq: 800, dur: 0.3, gain: 0.2, sweepTo: 200 });
  const osc = fc.sources.find((s) => s.kind === "osc")!;
  near(osc.stopAt!, 0.12, 1e-9);
  const noise = fc.sources.filter((s) => s.kind === "source").pop()!;
  near(noise.stopAt!, 0.32, 1e-9);
  eq(fc.endless.length, 0);
});

test("duck: dips the buses and schedules recovery to their level", () => {
  const { a } = engine();
  a.setLevel("music", 1);
  a.duck(["music"], 0.5, { attack: 0.05, hold: 0.5, release: 0.4 });
  const ev = (a.bus("music") as unknown as FakeGain).gain.events;
  ok(ev.some(([k, v]) => k === "linear" && Math.abs(v! - 0.5) < 1e-9));
  ok(ev.some(([k, v, t]) => k === "target" && v === 1 && Math.abs(t! - 0.55) < 1e-9));
});

test("frame budget: allow() caps per key until frame()", () => {
  const { a } = engine();
  eq([a.allow("hit", 2), a.allow("hit", 2), a.allow("hit", 2)], [true, true, false]);
  a.frame();
  ok(a.allow("hit", 2));
});

// ── Spatial ──

const two: Hearing = {
  views: [
    { x: 0, z: 0, range: 10, left: 0, span: 0.5 },
    { x: 100, z: 0, range: 10, left: 0.5, span: 0.5 },
  ],
  own: new Set([7]),
};

test("spatial: loudest view wins, panned by that view's screen slice", () => {
  const p = place(two, 100, 0, 0)!;
  near(p.gain, 1);
  ok(p.pan > 0, "right player's view pans right");
  const l = place(two, 0, 0, 0)!;
  ok(l.pan < 0);
  const edge = place(two, 9, 0, 0)!;
  ok(edge.gain < 1 && edge.gain > 0);
  eq(place(two, 50, 0, 0), null, "between views, out of range of both");
});

test("spatial: own sounds have a floor; off screen is muffled; lean keeps full gain", () => {
  const far = place(two, 50, 0, 0, 7)!;
  near(far.gain, 0.32);
  ok(far.muffle);
  const proj: Hearing = {
    views: [{ x: 0, z: 0, range: 10, left: 0, span: 1, project: () => ({ sx: 0.5, visible: false }) }],
  };
  const m = place(proj, 1, 0, 1)!;
  ok(m.muffle);
  near(m.gain, 0.65);
  const ln = lean(two, 100, 0, 0);
  eq(ln.gain, 1);
  ok(ln.pan > 0);
});

// ── Ambience ──

test("ambience: beds loop on the ambience bus and always get stops when replaced", () => {
  const { a, fc } = engine();
  const amb = new Ambience(a, () => 0.5);
  amb.setBeds([{ id: "bed", level: 0.8 }]);
  amb.setBeds([{ id: "bed", level: 0.8 }]);
  eq(amb.loops, 1, "unchanged beds aren't restarted");
  const first = srcOf(fc)[0];
  ok(first.loop);
  ok((first.out[0] as FakeGain).reaches(a.bus("ambience") as unknown as FakeGain));
  eq(first.stopAt, null);
  amb.setBeds([]);
  ok(first.stopAt !== null, "replaced bed is stopped");
  amb.emitter("torch", "bed", 0.4, [{ x: 1, z: 0 }], two);
  eq(amb.loops, 1);
  amb.stop();
  eq(fc.endless.length, 0, "nothing loops forever after stop()");
});

test("ambience: critters call between lo and hi seconds", () => {
  const { a, fc } = engine();
  const amb = new Ambience(a, () => 0.5);
  const list = [{ id: "hit", lo: 2, hi: 4 }];
  amb.critters(list);
  eq(srcOf(fc).length, 0);
  fc.currentTime = 2.9;
  amb.critters(list);
  eq(srcOf(fc).length, 0);
  fc.currentTime = 3.01;
  amb.critters(list);
  eq(srcOf(fc).length, 1);
});

// ── Music ──

test("music: plays the wanted track, crossfades on change with a scheduled stop, ducks", async () => {
  const { a, fc } = engine();
  const music = new MusicPlayer(
    a,
    { menu: { url: "menu.mp3", loopEnd: 2 }, battle: { url: "battle.mp3" } },
    {
      load: async () => asBuf(new FakeBuffer(3)),
      prefetch: false,
    },
  );
  music.set("menu");
  music.update();
  eq(music.current, null, "loading");
  await new Promise((r) => setTimeout(r, 0));
  music.update();
  eq(music.current, "menu");
  const menu = fc.sources[fc.sources.length - 1] as FakeSource;
  ok(menu.loop);
  eq(menu.loopEnd, 2);
  ok((menu.out[0] as FakeGain).reaches(a.bus("music") as unknown as FakeGain));
  fc.currentTime = 10;
  music.set("battle", 0.5);
  music.update();
  near(menu.stopAt!, 11.3, 1e-9);
  await new Promise((r) => setTimeout(r, 0));
  music.update();
  eq(music.current, "battle");
  music.set("battle", 0.2);
  music.update();
  const battle = fc.sources[fc.sources.length - 1] as FakeSource;
  ok((battle.out[0] as FakeGain).gain.events.some(([k, v]) => k === "target" && Math.abs(v! - 0.2) < 1e-9));
  music.stop();
  eq(fc.endless.length, 0);
});

test("music: streamed tracks play through a media element, crossfade and get paused after their fade", () => {
  const { a, fc } = engine();
  const els: FakeMedia[] = [];
  const music = new MusicPlayer(
    a,
    { title: { url: "title.ogg", stream: true }, run: { url: "run.ogg", stream: true, gain: 0.5 } },
    { element: (u) => (els.push(new FakeMedia(u)), els[els.length - 1]), fade: 1 },
  );
  music.set("title");
  music.update();
  eq(music.current, "title", "streams start at once");
  eq(els.length, 1);
  ok(els[0].playing && els[0].loop);
  ok(els[0].node!.reaches(a.bus("music") as unknown as FakeNode));
  fc.currentTime = 5;
  music.set("run");
  music.update();
  eq(music.current, "run");
  eq(els.length, 2);
  ok(els[0].playing, "the old stream fades first");
  eq(music.streams, 2);
  fc.currentTime = 6.2;
  music.update();
  ok(!els[0].playing, "paused after its fade");
  ok(els[1].playing);
  eq(music.streams, 1);
  music.stop();
  fc.currentTime = 7;
  music.update();
  ok(!els[1].playing, "stop() pauses the stream too");
  eq(fc.sources.filter((s) => s.kind === "source" && s.buffer && s.buffer.duration !== 1).length, 0, "nothing decoded");
});
