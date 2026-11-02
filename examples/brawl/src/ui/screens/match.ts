// In-match screens: the HUD (drives the match every frame, turns events into callouts, player panels, name tags,
// the online stall overlay), the pause overlay (a local pause stops a local match; online the match goes on and
// the pausing player just stands still), and the results screen, which records the match in the save.
import { MenuList, inset, label, panel, type Screen } from "@kindling/ui";
import { outcomeOf } from "@kindling/save";
import type { App, Frame } from "../../app/app.ts";
import { Controls } from "../../app/controls.ts";
import { PALETTE } from "../../app/select.ts";
import { IDLE } from "../../sim/types.ts";
import type { World } from "../../sim/world.ts";
import { ROVER_INFO } from "../rovers.ts";
import { chip, dim, footer, header, lighten, pips } from "../kit.ts";

export function matchScreen(app: App): Screen<Frame> {
  let overFor = 0;
  /** Input seats with their pause menu open (online: they feed idle commands). */
  const pausedSeats = new Set<number>();
  const nameOf = (seat: number) => app.match?.spec.names[seat] ?? `P${seat + 1}`;
  const colorOf = (seat: number) => PALETTE[app.match?.spec.colors[seat] ?? seat];
  const hud = {
    name: "match",
    pausedSeats,
    tick(dt: number) {
      const m = app.match;
      if (!m) return;
      const input = app.controls.input;
      for (const { input: seat } of m.localSeats()) {
        const p = input.players[seat];
        const cmd = pausedSeats.has(seat) || !p ? IDLE : Controls.command(p);
        if (m.online) app.session?.input(seat, cmd);
        else app.controls.latch(seat, cmd);
      }
      m.update(dt, performance.now());
      for (const e of app.frameEvents) {
        if (e.type === "countdown") app.callouts.push(String(e.n), { lane: "big", hold: 0.75 });
        if (e.type === "fight")
          app.callouts.push(e.round === 1 ? "FIGHT!" : `ROUND ${e.round}`, {
            lane: "big",
            hold: 0.9,
            color: "#f0c450",
          });
        if (e.type === "fall" && e.by >= 0)
          app.callouts.push(`${nameOf(e.by)} KNOCKS OUT ${nameOf(e.seat)}`, { lane: "banner", color: colorOf(e.by) });
        if (e.type === "fall" && e.by < 0)
          app.callouts.push(`${nameOf(e.seat)} DROVE OFF THE EDGE`, { lane: "banner" });
        if (e.type === "suddenDeath")
          app.callouts.push("SUDDEN DEATH", { sub: "THE RING IS SHRINKING", lane: "big", hold: 1.6, color: "#e85030" });
        if (e.type === "roundOver")
          app.callouts.push(e.winner >= 0 ? `${nameOf(e.winner)} TAKES ROUND ${e.round}` : "NOBODY WINS THE ROUND", {
            lane: "big",
            hold: 2,
            color: e.winner >= 0 ? colorOf(e.winner) : undefined,
          });
      }
      if (m.world.over) {
        overFor += dt;
        if (overFor > 2.8) {
          overFor = 0;
          app.endMatch();
          app.screens.reset(app.s.results());
        }
      }
    },
    update(_dt: number, f: Frame) {
      const m = app.match;
      if (!m) return;
      for (const { input: seat } of m.localSeats())
        if (app.controls.input.players[seat]?.pressed.pause) {
          pausedSeats.add(seat);
          app.screens.push(pauseScreen(app, seat, () => pausedSeats.delete(seat)));
          return;
        }
      void f;
    },
    draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
      const m = app.match;
      const world = m?.world ?? app.lastWorld;
      if (!world || !m) return;
      drawHud(app, world, w, h, ctx);
    },
  };
  return hud;
}

function drawHud(app: App, world: World, w: number, h: number, ctx: CanvasRenderingContext2D): void {
  const ui = app.ui;
  const t = ui.theme;
  const spec = app.match!.spec;
  const st = world.state;
  const screen = { x: 0, y: 0, w, h };
  // name tags over rovers
  const rect = app.root.getBoundingClientRect();
  const k = h / (rect.height || innerHeight);
  for (const r of st.rovers) {
    if (!r.alive) continue;
    const p = app.view.project(r.x, 1.9, r.z, rect.width || innerWidth, rect.height || innerHeight);
    if (!p.visible) continue;
    const tw = Math.min(60, t.font.measure(spec.names[r.seat], t.metrics.small) + 4);
    const tr = { x: p.x * k - tw / 2, y: p.y * k - 10, w: tw, h: 9 };
    if (tr.x < 2 || tr.x + tr.w > w - 2 || tr.y < 2 || tr.y + tr.h > h - 2) continue;
    label(ui, spec.names[r.seat], tr, {
      align: "center",
      size: t.metrics.small,
      color: lighten(PALETTE[spec.colors[r.seat]], 0.35),
      id: `tag${r.seat}`,
    });
  }
  // round + clock
  const m = st.match;
  const secs = m.phase === "fight" ? Math.floor((world.tick - m.fightAt) * world.dt) : 0;
  const top = { x: w / 2 - 55, y: 6, w: 110, h: 24 };
  panel(ui, "banner", top);
  ui.debug?.box("hud.round", top, { bounds: screen, group: "hud", ctx });
  label(
    ui,
    `ROUND ${m.round}`,
    { x: top.x + 6, y: top.y + 2, w: top.w - 12, h: 11 },
    { align: "center", size: t.metrics.small, id: "hud.roundl" },
  );
  const sd = m.ringR < world.t.match.arenaRadius;
  label(
    ui,
    sd ? "SUDDEN DEATH" : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`,
    { x: top.x + 6, y: top.y + 12, w: top.w - 12, h: 11 },
    {
      align: "center",
      size: t.metrics.small,
      color: sd ? "#ff7050" : t.colors.text,
      id: "hud.clock",
    },
  );
  // player panels (hidden under the pause menu, whose footer sits there)
  if (app.screens.top?.name !== "match" && app.screens.names.includes("pause")) return;
  const n = st.rovers.length;
  const gap = 6;
  const pw = Math.min(104, (w - 20 - gap * (n - 1)) / n);
  const total = pw * n + gap * (n - 1);
  const ph = 34;
  st.rovers.forEach((r, i) => {
    const pr = { x: (w - total) / 2 + i * (pw + gap), y: h - ph - 6, w: pw, h: ph };
    const color = PALETTE[spec.colors[i]];
    ctx.save();
    if (!r.alive) ctx.globalAlpha = 0.55;
    panel(ui, "card", pr, { tint: color, seed: i + 11 });
    ui.debug?.box(`hud.p${i}`, pr, { bounds: screen, group: "hud", ctx });
    const inner = inset(pr, 4);
    chip(ctx, inner.x + 4, inner.y + 4.5, 3.5, color);
    label(
      ui,
      spec.names[i],
      { x: inner.x + 10, y: inner.y - 1, w: inner.w * 0.6 - 10, h: 11 },
      { onPanel: true, size: t.metrics.small, id: `hud.n${i}` },
    );
    label(
      ui,
      ROVER_INFO[r.kind].name,
      { x: inner.x + 10, y: inner.y + 9, w: inner.w * 0.6 - 10, h: 9 },
      { onPanel: true, size: t.metrics.small * 0.8, color: t.colors.panelDim, id: `hud.k${i}` },
    );
    const dmgColor = r.dmg < 40 ? "#3a2410" : r.dmg < 90 ? "#b0601a" : "#b81c10";
    label(
      ui,
      r.alive ? `${r.dmg}%` : "OUT",
      { x: inner.x + inner.w * 0.55, y: inner.y - 1, w: inner.w * 0.45, h: 18 },
      {
        onPanel: true,
        size: t.metrics.text * 1.45,
        align: "right",
        color: r.alive ? dmgColor : t.colors.panelDim,
        id: `hud.d${i}`,
      },
    );
    pips(ui, { x: inner.x, y: inner.y + inner.h - 5, w: inner.w * 0.4, h: 4 }, r.wins, world.winRounds, "#e8b030");
    const cd = (ready: number, total: number) =>
      world.tick >= ready ? 1 : 1 - (ready - world.tick) / Math.max(1, world.ticks(total));
    const tune = world.t;
    meter(
      ctx,
      { x: inner.x + inner.w * 0.5, y: inner.y + inner.h - 5, w: inner.w * 0.22, h: 3 },
      cd(r.dashReady, tune.rovers[r.kind].dashCd),
      color,
    );
    meter(
      ctx,
      { x: inner.x + inner.w * 0.76, y: inner.y + inner.h - 5, w: inner.w * 0.24, h: 3 },
      cd(r.slamReady, tune.moves.special.cooldown),
      "#9affd0",
    );
    ctx.restore();
  });
  // online stall
  const stall = app.session?.stall;
  if (stall) {
    const msg =
      stall.reason === "host"
        ? "WAITING FOR THE HOST..."
        : stall.reason === "reconnecting"
          ? "RECONNECTING..."
          : `WAITING FOR ${stall.names.join(", ")}${stall.dropInMs >= 0 ? ` · CPU IN ${Math.ceil(stall.dropInMs / 1000)}` : ""}`;
    const sr = { x: w / 2 - 120, y: 40, w: 240, h: 22 };
    panel(ui, "dialog", sr);
    label(ui, msg, inset(sr, 3, 8), { onPanel: true, align: "center", size: t.metrics.small, id: "stall" });
    ui.debug?.box("stall", sr, { bounds: screen, group: "hud", ctx });
  }
}

function meter(
  ctx: CanvasRenderingContext2D,
  r: { x: number; y: number; w: number; h: number },
  k: number,
  color: string,
): void {
  ctx.fillStyle = "#0b0806";
  ctx.fillRect(r.x - 0.5, r.y - 0.5, r.w + 1, r.h + 1);
  ctx.fillStyle = "rgba(90,60,30,0.4)";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = k >= 1 ? color : "rgba(200,170,120,0.8)";
  ctx.fillRect(r.x, r.y, r.w * Math.max(0, Math.min(1, k)), r.h);
}

export function pauseScreen(app: App, seat: number, done: () => void): Screen<Frame> {
  const online = !!app.match?.online;
  const menu = new MenuList(
    [
      { id: "resume", label: "RESUME" },
      { id: "options", label: "OPTIONS" },
      { id: "quit", label: online ? "LEAVE ROOM" : "QUIT MATCH" },
    ],
    { sound: (k) => app.sound.ui(k), hitId: "pause" },
  );
  const close = () => {
    app.screens.pop();
  };
  return {
    name: "pause",
    opaque: false,
    enter() {
      if (app.match && !online) app.match.paused = true;
      app.controls.nav.reset();
    },
    exit() {
      if (app.match && !online) app.match.paused = false;
      done();
    },
    update(_dt, f) {
      const p = app.controls.input.players[seat];
      if (p?.pressed.pause) return close();
      const ev = menu.update(f.nav);
      if (ev?.type === "back") return close();
      if (ev?.type !== "select") return;
      if (ev.item.id === "resume") close();
      else if (ev.item.id === "options") app.screens.push(app.s.options());
      else
        app.screens.push(
          app.s.confirm(
            online ? "LEAVE THE ROOM?" : "QUIT THE MATCH?",
            online ? "A CPU WILL TAKE YOUR SEAT." : "THE MATCH WILL NOT COUNT.",
            () => {
              app.leaveOnline();
              app.endMatch();
              app.newAttract();
              app.screens.reset(app.s.menu());
            },
          ),
        );
    },
    draw(ctx, w, h) {
      const ui = app.ui;
      dim(ui, w, h, 0.6);
      header(ui, w, "PAUSED", 40);
      const r = { x: w / 2 - 70, y: 80, w: 140, h: 3 * 20 - 3 };
      panel(ui, "window", inset(r, -6));
      ui.debug?.box("pause.window", inset(r, -6), { bounds: { x: 0, y: 0, w, h }, ctx });
      menu.draw(ui, r, { rowH: 17, gap: 3 });
      if (online) {
        const nr = { x: w / 2 - 110, y: r.y + r.h + 14, w: 220, h: 12 };
        label(ui, "ONLINE: THE MATCH GOES ON WITHOUT YOU", nr, {
          align: "center",
          size: ui.theme.metrics.small,
          color: ui.theme.colors.accent,
          id: "pause.online",
        });
      }
      footer(ui, w, h, [
        { glyph: app.controls.glyph("attack"), label: "SELECT" },
        { glyph: app.controls.glyph("pause"), label: "RESUME" },
      ]);
    },
  };
}

export function resultsScreen(app: App): Screen<Frame> {
  const world = app.lastWorld!;
  const spec = app.lastSpec!;
  const online = app.session;
  const order = world.state.rovers
    .map((r) => r.seat)
    .sort((a, b) => {
      const A = world.state.rovers[a];
      const B = world.state.rovers[b];
      return B.wins - A.wins || B.kos - A.kos || A.falls - B.falls || a - b;
    });
  const winner = world.state.match.winner;
  const notes: string[] = [];
  let recorded = false;
  const record = () => {
    if (recorded || winner < 0) return;
    recorded = true;
    spec.rovers.forEach((rover, seat) => {
      if (spec.cpu[seat]) return;
      app.save.rovers.result(rover, outcomeOf(winner, seat));
      const ref = app.save.names.find(spec.names[seat]);
      const e = ref && app.save.names.get(ref.id);
      if (e) {
        e.games++;
        if (seat === winner) e.wins++;
      }
    });
    if (!spec.cpu[winner] && app.save.rovers.best(spec.rovers[winner], "fastest", Math.round(world.time), "min"))
      notes.push(`NEW RECORD: FASTEST ${ROVER_INFO[spec.rovers[winner]].name} WIN, ${Math.round(world.time)}S`);
    app.save.logMatch({
      at: Date.now(),
      winner: spec.names[winner],
      players: spec.names,
      seconds: Math.round(world.time),
      online: !!online,
    });
  };
  const host = !online || online.role === "host";
  const menu = new MenuList(
    host
      ? [
          { id: "rematch", label: "REMATCH" },
          { id: "select", label: online ? "BACK TO LOBBY" : "CHANGE ROVERS" },
          { id: "menu", label: online ? "LEAVE ROOM" : "MAIN MENU" },
        ]
      : [
          { id: "wait", label: "WAITING FOR HOST", disabled: true },
          { id: "menu", label: "LEAVE ROOM" },
        ],
    { sound: (k) => app.sound.ui(k), hitId: "results" },
  );
  return {
    name: "results",
    enter() {
      record();
      app.view.orbit = 0;
    },
    update(_dt, f) {
      const ev = menu.update(f.nav);
      if (ev?.type !== "select") return;
      const id = ev.item.id;
      if (id === "rematch" || id === "select") {
        if (online) {
          online.endMatch();
          app.screens.reset(app.s.select());
          if (id === "rematch") online.edit((s) => s.slots.forEach((x) => x.kind === "human" && (x.ready = true)));
        } else if (id === "rematch") app.startLocal(app.select);
        else {
          for (const x of app.select.slots) x.ready = x.kind === "cpu";
          app.screens.reset(app.s.menu());
          app.screens.push(app.s.select());
        }
      } else {
        app.leaveOnline();
        app.newAttract();
        app.screens.reset(app.s.menu());
      }
    },
    draw(ctx, w, h) {
      const ui = app.ui;
      const t = ui.theme;
      dim(ui, w, h, 0.5);
      const screen = { x: 0, y: 0, w, h };
      header(ui, w, "RESULTS");
      const wcol = PALETTE[spec.colors[winner] ?? 0];
      const ban = { x: w / 2 - 120, y: 40, w: 240, h: 24 };
      panel(ui, "banner", ban, { tint: wcol });
      label(ui, winner >= 0 ? `${spec.names[winner]} WINS!` : "NO WINNER", inset(ban, 3, 10), {
        align: "center",
        size: t.metrics.text * 1.3,
        id: "res.win",
      });
      ui.debug?.box("res.banner", ban, { bounds: screen, group: "res", ctx });
      // standings table
      const tw = Math.min(300, w - 40);
      const tr = { x: (w - tw) / 2, y: 70, w: tw, h: 16 + order.length * 15 + 6 };
      panel(ui, "card", tr, { seed: 9 });
      ui.debug?.box("res.table", tr, { bounds: screen, group: "res", ctx });
      const cols = [0, 0.08, 0.42, 0.62, 0.74, 0.86];
      const heads = ["", "PLAYER", "ROVER", "ROUNDS", "KOS", "FALLS"];
      const inner = inset(tr, 6, 10);
      heads.forEach((s, i) =>
        label(
          ui,
          s,
          { x: inner.x + inner.w * cols[i], y: inner.y, w: inner.w * ((cols[i + 1] ?? 1) - cols[i]), h: 10 },
          {
            onPanel: true,
            size: t.metrics.small * 0.85,
            color: t.colors.panelDim,
            id: `res.h${i}`,
          },
        ),
      );
      order.forEach((seat, k) => {
        const r = world.state.rovers[seat];
        const y = inner.y + 13 + k * 15;
        const cells = [
          `${k + 1}`,
          spec.names[seat] + (spec.cpu[seat] ? " (CPU)" : ""),
          ROVER_INFO[r.kind].name,
          `${r.wins}`,
          `${r.kos}`,
          `${r.falls}`,
        ];
        chip(ctx, inner.x + inner.w * 0.08 - 6, y + 7, 3.5, PALETTE[spec.colors[seat]]);
        cells.forEach((s, i) =>
          label(
            ui,
            s,
            { x: inner.x + inner.w * cols[i], y, w: inner.w * ((cols[i + 1] ?? 1) - cols[i]) - 2, h: 14 },
            {
              onPanel: true,
              size: i === 0 ? t.metrics.text * 1.1 : t.metrics.small * 1.05,
              id: `res.${k}.${i}`,
            },
          ),
        );
      });
      let y = tr.y + tr.h + 8;
      for (const note of notes) {
        const nr = { x: w / 2 - 140, y: y - 4, w: 280, h: 11 };
        label(ui, note, nr, { align: "center", size: t.metrics.small, color: t.colors.accent, id: "res.note" });
        y += 12;
      }
      const mh = menu.items.length * 17 - 3;
      const mr = { x: w / 2 - 70, y: Math.min(Math.max(y + 4, h - 80), h - 25 - mh), w: 140, h: mh };
      panel(ui, "window", inset(mr, -5));
      ui.debug?.box("res.menu", inset(mr, -5), { bounds: { x: 0, y: 0, w, h: h - 20 }, group: "res", ctx });
      menu.draw(ui, mr, { rowH: 14, gap: 3 });
      footer(ui, w, h, [{ glyph: app.controls.glyph("attack"), label: "SELECT" }]);
    },
  };
}
