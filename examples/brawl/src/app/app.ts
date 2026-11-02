// The App: one object holding all client state (save, input, sound, the 3D view, the UI canvas and screen stack,
// the running match or the attract-mode world, the online session), and the frame loop that drives them. Screens
// are plain objects over it (src/ui/screens). Debug URL params enter any state directly so screenshots and tests
// never click through menus:
//   ?screen=title|menu|options|controls|select|match|pause|results|online|lobby|credits|quit|name
//   ?players=N (match / select / results: N seats, CPUs fill the rest)  ?seed=N  ?t=<seconds of match pre-roll>
//   ?perf (perf overlay)  ?layoutdebug (layout debugger, issues in window.game.layoutIssues)  ?holiday=xmas|none
//   ?mute  ?room=CODE&name=NAME (join an online room)  ?host=NAME (host one)
import { FixedLoop, Holidays, PerfMeter, animationFrames, dateRange, drawPerf } from "@kindling/core";
import { Callouts, HitList, LayoutDebug, ScreenManager, UiCanvas, type Nav, type Theme, type Ui } from "@kindling/ui";
import { cpuMatch, type CpuMatch } from "../sim/headless.ts";
import { ROVERS, type GameEvent } from "../sim/types.ts";
import type { World } from "../sim/world.ts";
import { OnlineSession } from "../net/session.ts";
import { loadTheme, UI_H } from "../ui/kit.ts";
import { View } from "../view/view.ts";
import { Controls, type Action } from "./controls.ts";
import { LocalMatch, OnlineMatch, type MatchDriver } from "./match.ts";
import { createSave, type Save } from "./save.ts";
import {
  addCpu,
  CPU_SKILLS,
  matchSpec,
  newSelect,
  PALETTE,
  playing,
  seatHuman,
  type MatchSpec,
  type SelectState,
} from "./select.ts";
import { Sound, type Track } from "./sound.ts";
import { NetLink } from "@kindling/net";
import { ROOM_KIND } from "../net/session.ts";

export const BUILD = "brawl-1";

export interface Frame {
  now: number;
  dt: number;
  nav: Nav & { seat: number; pressed: Partial<Record<Action, boolean>> };
}

export type ScreenName =
  | "title"
  | "menu"
  | "options"
  | "controls"
  | "select"
  | "match"
  | "pause"
  | "results"
  | "online"
  | "credits"
  | "dialog"
  | "name";

export interface AppScreens {
  title(): import("@kindling/ui").Screen<Frame>;
  menu(): import("@kindling/ui").Screen<Frame>;
  options(): import("@kindling/ui").Screen<Frame>;
  controls(): import("@kindling/ui").Screen<Frame>;
  select(): import("@kindling/ui").Screen<Frame>;
  match(): import("@kindling/ui").Screen<Frame>;
  pause(): import("@kindling/ui").Screen<Frame>;
  results(): import("@kindling/ui").Screen<Frame>;
  online(): import("@kindling/ui").Screen<Frame>;
  credits(): import("@kindling/ui").Screen<Frame>;
  confirm(
    title: string,
    body: string,
    yes: () => void,
    o?: { yes?: string; no?: string; danger?: boolean },
  ): import("@kindling/ui").Screen<Frame>;
  message(title: string, body: string, ok?: () => void): import("@kindling/ui").Screen<Frame>;
}

export class App {
  readonly params = new URLSearchParams(location.search);
  readonly save: Save = createSave();
  readonly controls = new Controls(this.save);
  readonly sound = new Sound();
  readonly holidays = new Holidays<"xmas">({ search: location.search }).register("xmas", dateRange(11, 1, 11, 31));
  readonly perf = new PerfMeter({ enabled: this.params.has("perf") });
  readonly debug: LayoutDebug | null = this.params.has("layoutdebug") ? new LayoutDebug() : null;
  readonly layoutIssues = new Map<string, string>();
  readonly hits = new HitList();
  readonly callouts = new Callouts();
  readonly screens = new ScreenManager<Frame>({ kind: "fade", duration: 0.2 });
  readonly root: HTMLElement;
  view!: View;
  theme!: Theme;
  uic!: UiCanvas;
  ui!: Ui;
  s!: AppScreens;
  /** Local select screen state (online play uses the session's mirrored one). */
  select: SelectState = newSelect();
  match: MatchDriver | null = null;
  session: OnlineSession | null = null;
  /** Results of the last match (kept for the results screen). */
  lastWorld: World | null = null;
  lastSpec: MatchSpec | null = null;
  private attract: (CpuMatch & { loop: FixedLoop }) | null = null;
  time = 0;
  frames = 0;
  ready = false;
  /** Presentation events of the frame (HUD reads them). */
  readonly frameEvents: GameEvent[] = [];

  constructor(root: HTMLElement, screens: (app: App) => AppScreens) {
    this.root = root;
    this.holidays.enabled = !!this.save.data.options.holidays;
    this.s = screens(this);
  }

  async start(): Promise<void> {
    this.view = new View(this.root, {
      scale: () => (this.params.has("scale") ? Number(this.params.get("scale")) : this.save.data.options.scale),
      shake: () => this.save.data.options.shake,
      holiday: () => this.holidays.active(),
    });
    this.uic = new UiCanvas({ kind: "height", height: UI_H }, this.root);
    this.uic.canvas.className = "ui";
    [this.theme] = await Promise.all([loadTheme(), this.view.load()]);
    this.sound.attach(window);
    this.applyOptions();
    this.newAttract();
    this.route();
    this.ready = true;
    animationFrames((dt, now) => this.frame(dt, now));
  }

  applyOptions(): void {
    const o = this.save.data.options;
    this.sound.levels(this.params.has("mute") ? { music: 0, sfx: 0, ambience: 0 } : o);
    this.holidays.enabled = !!o.holidays;
  }

  // ── Worlds ──

  /** A CPU match on the platform behind the menus. */
  newAttract(): void {
    const seed = (this.attract?.world.spec.seed ?? Number(this.params.get("seed") ?? 7)) + 1;
    const m = cpuMatch(
      { seed, rovers: [ROVERS[seed % 3], ROVERS[(seed + 1) % 3], ROVERS[(seed + 2) % 3], ROVERS[seed % 2]] },
      0.75,
    );
    const loop = new FixedLoop({
      dt: m.world.dt,
      step: () => {
        this.view.beforeStep();
        m.world.step(m.bots.map((b) => b.command(m.world)));
        this.view.events(m.world.events);
      },
    });
    this.attract = { ...m, loop };
    this.view.setWorld(
      m.world,
      [0, 1, 2, 3].map((i) => PALETTE[(i * 3 + seed) % PALETTE.length]),
    );
  }

  /** Shows the select slots' rovers on the platform (not stepped). */
  showroom(state: SelectState): void {
    const spec = matchSpec(state, 1);
    if (spec.rovers.length < 2) {
      if (!this.attract) this.newAttract();
      return;
    }
    const key = JSON.stringify([spec.rovers, spec.colors]);
    if (key === this.showKey) return;
    this.showKey = key;
    this.attract = null;
    const m = cpuMatch(spec);
    this.view.setWorld(
      m.world,
      spec.colors.map((c) => PALETTE[c]),
    );
  }
  private showKey = "";

  /** Starts a local match from the select state. */
  startLocal(state: SelectState, seedOverride?: number): void {
    const seed = seedOverride ?? Date.now() >>> 0;
    const spec = matchSpec(state, seed);
    const order = playing(state);
    // world seat -> input seat (local slots are input seats) or -1 for CPUs
    const inputs = order.map((slot) => (state.slots[slot].kind === "human" ? slot : -1));
    const skills = order.map((slot) => state.slots[slot].skill);
    this.controls.clearLatches();
    this.match = new LocalMatch(
      spec,
      inputs,
      skills,
      (input) => this.controls.take(input),
      (evs, w) => this.present(evs, w),
      () => this.view.beforeStep(),
    );
    this.beginMatch(spec);
  }

  /** Starts showing an online match the session began. */
  startOnline(spec: MatchSpec): void {
    if (!this.session) return;
    this.match = new OnlineMatch(this.session, spec, (evs, w) => this.present(evs, w));
    this.beginMatch(spec);
  }

  private beginMatch(spec: MatchSpec): void {
    this.attract = null;
    this.showKey = "";
    this.lastSpec = spec;
    this.callouts.clear();
    this.view.setWorld(
      this.match!.world,
      spec.colors.map((c) => PALETTE[c]),
    );
    this.screens.reset(this.s.match());
  }

  endMatch(): void {
    if (this.match) this.lastWorld = this.match.world;
    this.match = null;
  }

  leaveOnline(): void {
    this.session?.leave();
    this.session = null;
  }

  /** One stepped tick's events -> view, sound, HUD. */
  present(evs: readonly GameEvent[], _w: World): void {
    this.view.events(evs);
    this.sound.events(evs);
    for (const e of evs) this.frameEvents.push(e);
  }

  // ── Online ──

  connect(role: "host" | "guest", name: string, room = ""): OnlineSession {
    this.leaveOnline();
    const cid = sessionStorage.getItem("brawl.cid") ?? Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem("brawl.cid", cid);
    const link = new NetLink({ build: BUILD, cid, autoUpdateMs: 500 });
    const session = new OnlineSession({
      link,
      role,
      build: BUILD,
      note: (n) => {
        if (n.type === "start") this.startOnline(n.spec);
        if (n.type === "end" && this.session === session) this.onOnlineEnd(n.reason);
        if (n.type === "drop")
          this.callouts.push(n.mine ? "YOU WERE DROPPED" : "A CPU TAKES OVER", {
            sub: n.mine ? "A CPU PLAYS FOR YOU" : `P${n.seats.map((s) => s + 1).join(", ")} LOST CONNECTION`,
            lane: "banner",
          });
        if (n.type === "desync")
          this.callouts.push("OUT OF SYNC", { sub: n.sections.join(", "), lane: "banner", color: "#e04030" });
        if (n.type === "closed" && this.session === session) this.onOnlineClosed(n.reason);
        if (n.type === "refused" && this.session === session) this.onOnlineClosed("refused");
      },
    });
    if (role === "host")
      link.host({ name, kind: ROOM_KIND, meta: { name, seats: 4, mode: "FFA", players: 1, phase: "lobby" } });
    else link.join({ name, kind: ROOM_KIND, room });
    this.session = session;
    return session;
  }

  private onOnlineEnd(reason: string): void {
    if (reason === "ended") {
      // the host went back to the lobby (rematch)
      this.endMatch();
      if (this.screens.top?.name !== "select") this.screens.reset(this.s.select());
    } else this.onOnlineClosed(reason);
  }

  private onOnlineClosed(reason: string): void {
    const why: Record<string, string> = {
      "host-left": "THE HOST HAS LEFT THE ROOM.",
      "host-silent": "THE HOST STOPPED ANSWERING.",
      lost: "THE CONNECTION WAS LOST.",
      refused: "THE ROOM REFUSED US: IT IS FULL, GONE, OR ON ANOTHER VERSION.",
      kicked: "YOU WERE REMOVED FROM THE ROOM.",
      unreachable: "COULD NOT REACH THE SERVER.",
    };
    this.leaveOnline();
    this.endMatch();
    this.newAttract();
    this.screens.reset(this.s.menu());
    this.screens.push(
      this.s.message("DISCONNECTED", why[reason] ?? `THE ONLINE SESSION ENDED (${reason.toUpperCase()}).`),
    );
  }

  // ── Debug routes ──

  private route(): void {
    const p = this.params;
    const screen = (p.get("screen") ?? "title") as ScreenName | "lobby" | "quit";
    const n = Math.max(2, Math.min(4, Number(p.get("players") ?? 4)));
    const demoSelect = () => {
      const s = newSelect();
      seatHuman(s, 0, this.save.seatName(0) === "P1" ? "KAY" : this.save.seatName(0));
      s.slots[0].ready = true;
      if (n > 1) {
        seatHuman(s, 1, "ROVA");
        s.slots[1].rover = "brute";
      }
      for (let i = 2; i < n; i++) addCpu(s);
      if (n > 2) s.slots[2].skill = CPU_SKILLS[2];
      return s;
    };
    const cpuOnly = () => {
      const s = demoSelect();
      for (const x of s.slots) if (x.kind === "human") x.ready = true;
      return s;
    };
    const tr = { kind: "none" as const, duration: 0 };
    if (p.get("room") || p.has("host")) {
      const name = (p.get("name") ?? p.get("host") ?? "GUEST").toUpperCase().slice(0, 8) || "GUEST";
      this.connect(p.get("room") ? "guest" : "host", name, (p.get("room") ?? "").toUpperCase());
      this.screens.reset(this.s.select(), tr);
      return;
    }
    switch (screen) {
      case "menu":
      case "options":
      case "controls":
      case "credits":
      case "online":
        this.screens.reset(this.s.menu(), tr);
        if (screen !== "menu") this.screens.push(this.s[screen](), tr);
        return;
      case "quit":
        this.screens.reset(this.s.menu(), tr);
        this.screens.push(
          this.s.confirm("RESET SAVE?", "EVERY NAME, RECORD AND CONTROLLER SETUP WILL BE FORGOTTEN.", () => {}, {
            danger: true,
            yes: "RESET",
            no: "KEEP",
          }),
          tr,
        );
        return;
      case "select":
      case "name":
        this.select = demoSelect();
        this.select.slots[0].ready = false;
        this.screens.reset(this.s.select(), tr);
        if (screen === "name") (this.screens.top as unknown as { editName(seat: number): void }).editName(0);
        return;
      case "match":
      case "pause":
      case "results": {
        this.select = cpuOnly();
        // every seat a CPU so the match plays itself for screenshots
        const s = structuredClone(this.select);
        for (const x of s.slots) if (x.kind === "human") x.kind = "cpu";
        this.startLocal(s, Number(p.get("seed") ?? 5));
        const m = this.match as LocalMatch;
        const pre = Number(p.get("t") ?? (screen === "results" ? 600 : 6));
        const end = screen === "results";
        for (let t = 0; t < pre * 60 && !(end && m.world.over); t++) m.loop.advance(m.world.dt);
        if (end) {
          this.endMatch();
          this.screens.reset(this.s.results(), tr);
        } else if (screen === "pause") this.screens.push(this.s.pause(), tr);
        return;
      }
      default:
        this.screens.reset(this.s.title(), tr);
    }
  }

  // ── Frame ──

  private frame(dt: number, nowS: number): void {
    const perf = this.perf;
    let t0 = perf.begin();
    this.time += dt;
    this.frames++;
    const now = nowS * 1000;
    this.controls.poll(nowS);
    const nav = this.controls.menu(nowS);
    t0 = perf.cpu("input", t0);
    const ctx = this.uic.begin();
    const W = this.uic.w;
    const H = this.uic.h;
    this.hits.clear();
    this.ui = { ctx, theme: this.theme, time: this.time, debug: this.debug, hits: this.hits };
    this.debug?.begin(ctx, { x: 0, y: 0, w: W, h: H });
    this.frameEvents.length = 0;
    if (this.session && !this.match) this.session.update(now);
    this.screens.update(dt, { now, dt, nav });
    if (!this.match && this.attract) {
      this.attract.loop.advance(dt);
      if (this.attract.world.over) this.newAttract();
    }
    t0 = perf.cpu("sim", t0);
    const rect = this.root.getBoundingClientRect();
    this.view.orbit = this.match ? 0 : this.attract ? 0.06 : 0;
    this.view.render(
      dt,
      this.match?.alpha ?? this.attract?.loop.alpha ?? 1,
      rect.width || innerWidth,
      rect.height || innerHeight,
    );
    t0 = perf.cpu("render", t0);
    this.screens.draw(ctx, W, H);
    this.callouts.update(this.time);
    if (this.match) this.callouts.draw(this.ui, { x: 0, y: 36, w: W, h: H - 80 }, this.time);
    if (this.debug) {
      const top = this.screens.top?.name ?? "";
      for (const is of this.debug.end()) this.layoutIssues.set(`${top}:${is.kind}:${is.id}`, is.detail);
      this.debug.draw(ctx);
    }
    t0 = perf.cpu("ui", t0);
    this.audio();
    perf.cpu("audio", t0);
    const snap = this.view.stats.frame(now);
    if (this.view.adapt(dt * 1000)) perf.stat("scale.changes");
    if (perf.enabled) {
      const s = this.view.stats.snapshot;
      if (s) {
        perf.stat("draw.calls", s.calls);
        perf.stat("triangles", s.triangles);
        if (s.gpu.scene !== undefined) perf.stat("gpu.ms", s.gpu.scene);
      }
      perf.stat("particles", this.view.particleCount);
      perf.stat("scale", this.view.adaptive.scale);
      perf.stat("voices", this.sound.engine.voices);
      perf.end();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawPerf(ctx, perf, 8, 8, `${Math.round(11 * devicePixelRatio)}px monospace`);
      ctx.restore();
    }
    void snap;
    this.expose();
  }

  private audio(): void {
    const top = this.screens.names;
    const name = top[top.length - 1] ?? "title";
    const inMatch = top.includes("match");
    const track: Track = inMatch ? "battle" : name === "results" ? "results" : name === "select" ? "select" : "menu";
    const duck = name === "pause" || name === "dialog" ? 0.45 : 1;
    this.sound.frame(track, duck, inMatch ? "arena" : "menu");
    const f = this.view.arenaCam.focus;
    this.sound.listen(f.x, f.z, Math.max(10, this.view.arenaCam.width * 0.6));
  }

  private expose(): void {
    (window as unknown as { game: unknown }).game = {
      ready: this.ready && this.view.ready,
      frames: this.frames,
      screen: this.screens.top?.name ?? "",
      busy: this.screens.busy,
      tick: this.match?.world.tick ?? -1,
      over: this.match?.world.over ?? false,
      room: this.session?.link.room ?? "",
      online: this.session
        ? { role: this.session.role, state: this.session.link.state, inMatch: this.session.inMatch }
        : null,
      hash: this.match?.world.hash() ?? 0,
      winner: this.lastWorld?.state.match.winner ?? this.match?.world.state.match.winner ?? -1,
      layoutIssues: [...this.layoutIssues].map(([k, v]) => `${k} ${v}`),
      holiday: this.holidays.active(),
      scale: this.view.adaptive.scale,
    };
  }
}
