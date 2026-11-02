// The select screen: four seat cards, press-to-join for every device, rover and colour per player, names, CPUs,
// ready flags. Local play edits the App's SelectState directly (slots = InputManager seats); online play shows the
// host's mirrored lobby state and sends this machine's players' changes as requests (the host's own apply them at
// once). The same screen is the online lobby, with the room code on top.
import { MenuNavigator, keyLabel } from "@kindling/input";
import {
  NameEntry,
  drawGlyph,
  glyphWidth,
  inset,
  label,
  panel,
  paragraph,
  type Glyph,
  type Rect,
  type Screen,
} from "@kindling/ui";
import type { App, Frame } from "../../app/app.ts";
import type { Action } from "../../app/controls.ts";
import {
  addCpu,
  applyReq,
  canStart,
  CPU_SKILLS,
  PALETTE,
  PALETTE_NAMES,
  removeCpu,
  seatHuman,
  SKILL_NAMES,
  vacate,
  type SelectReq,
  type SelectState,
} from "../../app/select.ts";
import { ROVER_INFO } from "../rovers.ts";
import { chip, dim, footer, header, pips } from "../kit.ts";

export function selectScreen(app: App): Screen<Frame> & { editName(seat: number): void } {
  const input = app.controls.input;
  const navs = [0, 1, 2, 3].map(
    () =>
      new MenuNavigator<Action>({
        up: "up",
        down: "down",
        left: "left",
        right: "right",
        confirm: ["attack"],
        back: ["back"],
      }),
  );
  let startIn = -1;
  let naming: { seat: number; entry: NameEntry; keyboard: boolean } | null = null;
  const online = () => app.session;
  const state = (): SelectState | null => (online() ? online()!.state : app.select);
  /** The lobby slot an input seat plays in. */
  const slotOf = (seat: number) => (online() ? online()!.slotOf(seat) : seat);
  const request = (seat: number, req: SelectReq) => {
    const s = online();
    if (s) s.request(seat, req);
    else applyReq(app.select, seat, req);
  };
  const isHost = () => !online() || online()!.role === "host";

  const onKey = (e: KeyboardEvent) => {
    if (!naming?.keyboard) return;
    if (e.key === "Enter") finishName();
    else if (e.key === "Escape") naming = null;
    else if (e.key === "Backspace") naming.entry.backspace();
    else if (/^[a-z0-9!-]$/i.test(e.key)) naming.entry.type(e.key.toUpperCase());
    else return;
    e.preventDefault();
  };
  const finishName = () => {
    if (!naming) return;
    const name = app.save.setSeatName(naming.seat, naming.entry.text);
    request(naming.seat, { op: "name", name });
    app.sound.ui("ok");
    naming = null;
    input.keyboard.typing = false;
  };

  const screen = {
    name: "select",
    enter() {
      input.joining = true;
      input.onJoin = (seat) => {
        app.sound.ui("join");
        if (!online()) seatHuman(app.select, seat, app.save.seatName(seat));
      };
      input.onLeave = (seat) => {
        if (!online()) vacate(app.select, seat);
      };
      // Seats taken before this screen (a previous match) are still in the state.
      addEventListener("keydown", onKey);
    },
    exit() {
      input.joining = false;
      input.onJoin = () => {};
      input.onLeave = () => {};
      input.keyboard.typing = false;
      removeEventListener("keydown", onKey);
    },
    editName(seat: number) {
      const d = input.players[seat];
      naming = {
        seat,
        entry: new NameEntry(state()?.slots[slotOf(seat)]?.name ?? "", 8, undefined, 10, (k) =>
          app.sound.ui(k === "key" ? "key" : k),
        ),
        keyboard: d?.family === "keyboard",
      };
      input.keyboard.typing = !!naming.keyboard;
    },
    update(_dt: number, f: Frame) {
      const st = state();
      const sess = online();
      if (sess) {
        const devs = input.players.flatMap((p, i) => (p.connected ? [{ device: i, name: app.save.seatName(i) }] : []));
        sess.setLocal(devs);
      }
      if (!st) {
        if (f.nav.b) (app.leaveOnline(), app.screens.pop());
        return;
      }
      app.showroom(st);
      if (naming) {
        const n = navs[naming.seat].read([input.players[naming.seat]], f.now / 1000);
        if (!naming.keyboard) {
          const ev = naming.entry.update({ dx: n.dx, dy: n.dy, a: n.confirm, b: n.back });
          if (ev === "done") finishName();
          else if (ev === "cancel") naming = null;
        }
        return;
      }
      let anySeated = false;
      input.players.forEach((p, seat) => {
        if (!p.connected) return;
        anySeated = true;
        const slotI = slotOf(seat);
        const slot = slotI >= 0 ? st.slots[slotI] : null;
        const n = navs[seat].read([p], f.now / 1000);
        if (!slot) return;
        if (n.dx && !slot.ready) (request(seat, { op: "rover", dir: n.dx }), app.sound.ui("move"));
        if (n.dy && !slot.ready) (request(seat, { op: "color", dir: n.dy }), app.sound.ui("adjust"));
        if (p.pressed.attack && !slot.ready) (request(seat, { op: "ready", on: true }), app.sound.ui("ok"));
        else if (p.pressed.back) {
          if (slot.ready) request(seat, { op: "ready", on: false });
          else {
            input.release(seat);
            if (!online()) vacate(app.select, seat);
          }
          app.sound.ui("back");
        } else if (p.pressed.special && !slot.ready) screen.editName(seat);
        else if (p.pressed.cpu && isHost()) {
          const edit = (s: SelectState) => {
            if (addCpu(s) >= 0) {
              const i = s.slots.map((x) => x.kind).lastIndexOf("cpu");
              s.slots[i].skill = CPU_SKILLS[app.save.data.options.cpu] ?? CPU_SKILLS[1];
            } else removeCpu(s);
          };
          if (sess) sess.edit(edit);
          else edit(app.select);
          app.sound.ui("adjust");
        }
      });
      // Nobody seated: back leaves the screen (any device).
      if (!anySeated && f.nav.b) {
        if (sess)
          app.screens.push(
            app.s.confirm(
              "LEAVE THE ROOM?",
              sess.role === "host"
                ? "EVERYONE IN THE ROOM WILL BE DISCONNECTED."
                : "YOU CAN REJOIN WITH THE ROOM CODE.",
              () => (app.leaveOnline(), app.screens.pop()),
            ),
          );
        else app.screens.pop();
        return;
      }
      if (canStart(st) && isHost() && st.phase === "pick") {
        if (startIn < 0) startIn = 1.6;
        startIn -= f.dt;
        if (startIn <= 0) {
          startIn = -1;
          if (sess) sess.startMatch();
          else app.startLocal(app.select);
        }
      } else startIn = -1;
    },
    draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
      const ui = app.ui;
      const t = ui.theme;
      const st = state();
      dim(ui, w, h, 0.25);
      const sess = online();
      header(ui, w, sess ? "ONLINE LOBBY" : "CHOOSE YOUR ROVER");
      const screenR = { x: 0, y: 0, w, h };
      if (sess) {
        const code = sess.link.room || "....";
        const info =
          sess.role === "host"
            ? `ROOM ${code}  ·  SHARE THE CODE`
            : `ROOM ${code}  ·  ${sess.link.state === "open" ? "CONNECTED" : sess.link.state.toUpperCase()}`;
        const r = { x: w / 2 - 100, y: 37, w: 200, h: 12 };
        label(ui, info, r, { align: "center", size: t.metrics.small, color: t.colors.accent, id: "room" });
        ui.debug?.box("room", r, { bounds: screenR, group: "chrome", ctx });
      }
      if (!st) {
        const r = { x: w / 2 - 100, y: h / 2 - 10, w: 200, h: 20 };
        label(ui, "CONNECTING...", r, { align: "center", id: "connecting" });
        footer(ui, w, h, [{ glyph: app.controls.glyph("back"), label: "CANCEL" }]);
        return;
      }
      const margin = 12;
      const gap = 8;
      const cw = Math.min(118, (w - margin * 2 - gap * 3) / 4);
      const total = cw * 4 + gap * 3;
      const ch = 128;
      const y = h - ch - 26;
      // Which input seat (on this machine) sits in each slot.
      const localOf = new Map<number, number>();
      input.players.forEach((p, seat) => p.connected && slotOf(seat) >= 0 && localOf.set(slotOf(seat), seat));
      st.slots.forEach((slot, i) => {
        const r = { x: (w - total) / 2 + i * (cw + gap), y, w: cw, h: ch };
        card(app, r, i, slot, localOf.get(i), sess ? (sess.seats[i]?.peer ?? -1) : -2);
        ui.debug?.box(`slot${i}`, r, { bounds: screenR, group: "cards", ctx });
      });
      if (startIn > 0) {
        const r = { x: w / 2 - 80, y: y - 30, w: 160, h: 20 };
        panel(ui, "banner", r);
        label(ui, `FIGHT IN ${Math.ceil(startIn)}`, inset(r, 2, 8), { align: "center", id: "startin" });
        ui.debug?.box("startin", r, { bounds: screenR, group: "chrome", ctx });
      } else if (sess && sess.role === "guest" && canStart(st)) {
        const r = { x: w / 2 - 90, y: y - 30, w: 180, h: 20 };
        panel(ui, "banner", r);
        label(ui, "WAITING FOR THE HOST", inset(r, 2, 8), { align: "center", id: "waithost" });
      }
      const seated = input.players.some((p) => p.connected);
      footer(
        ui,
        w,
        h,
        seated
          ? [
              { glyph: app.controls.glyph("attack"), label: "READY" },
              { glyph: app.controls.glyph("left"), label: "ROVER" },
              { glyph: app.controls.glyph("up"), label: "COLOUR" },
              { glyph: app.controls.glyph("special"), label: "NAME" },
              ...(isHost() ? [{ glyph: app.controls.glyph("cpu"), label: "ADD CPU" }] : []),
              { glyph: app.controls.glyph("back"), label: "LEAVE" },
            ]
          : [
              { glyph: app.controls.glyph("attack"), label: "JOIN" },
              { glyph: app.controls.glyph("back"), label: "BACK" },
            ],
      );
      if (naming) {
        c_dimAll(ctx, w, h);
        const r = { x: w / 2 - 120, y: 40, w: 240, h: 150 };
        naming.entry.draw(ui, r, `P${naming.seat + 1} NAME`);
        ui.debug?.box("name", r, { bounds: screenR, ctx });
        if (naming.keyboard) {
          const hr = { x: w / 2 - 120, y: r.y + r.h + 4, w: 240, h: 12 };
          label(ui, "TYPE A NAME  ·  ENTER TO SAVE  ·  ESC TO CANCEL", hr, {
            align: "center",
            size: t.metrics.small,
            id: "name.hint",
          });
        }
      }
    },
  };
  return screen as Screen<Frame> & { editName(seat: number): void };
}

function c_dimAll(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, w, h);
}

/** One seat card. `local`: the input seat on this machine in it; `peer`: online seat owner (-2 offline). */
function card(
  app: App,
  r: Rect,
  i: number,
  slot: SelectState["slots"][number],
  local: number | undefined,
  peer: number,
): void {
  const ui = app.ui;
  const t = ui.theme;
  const color = PALETTE[slot.color];
  const open = slot.kind === "open";
  panel(ui, "card", r, { tint: open ? undefined : color, seed: i + 1, selected: slot.ready });
  const inner = inset(r, 7);
  const line = (y: number, hh = 11): Rect => ({ x: inner.x, y, w: inner.w, h: hh });
  if (open) {
    label(ui, `P${i + 1}`, line(inner.y, 19), {
      onPanel: true,
      title: true,
      size: t.metrics.title,
      align: "center",
      color: t.colors.panelDim,
      id: `c${i}.p`,
    });
    paragraph(
      ui,
      "PRESS ANY BUTTON TO JOIN",
      { x: inner.x, y: inner.y + 34, w: inner.w, h: 30 },
      { onPanel: true, align: "center", id: `c${i}.join` },
    );
    const g: Glyph = app.controls.glyph("attack");
    const gh = 14;
    const gw = glyphWidth(t, g, gh);
    drawGlyph(ui, g, inner.x + (inner.w - gw) / 2, inner.y + 79, gh);
    ui.debug?.box(
      `c${i}.glyph`,
      { x: inner.x + (inner.w - gw) / 2, y: inner.y + 72, w: gw, h: gh },
      { bounds: r, ctx: ui.ctx },
    );
    return;
  }
  // header: chip, P#, name
  chip(ui.ctx, inner.x + 5, inner.y + 6, 4.5, color);
  label(
    ui,
    `P${i + 1}`,
    { x: inner.x + 13, y: inner.y, w: 16, h: 12 },
    { onPanel: true, size: t.metrics.small, color: t.colors.panelDim, id: `c${i}.n` },
  );
  label(
    ui,
    slot.name || `P${i + 1}`,
    { x: inner.x + 30, y: inner.y - 1, w: inner.w - 30, h: 14 },
    { onPanel: true, size: t.metrics.text * 1.05, id: `c${i}.name` },
  );
  const who =
    slot.kind === "cpu"
      ? `CPU · ${SKILL_NAMES[Math.max(0, CPU_SKILLS.indexOf(slot.skill))] ?? "NORMAL"}`
      : local !== undefined
        ? deviceName(app, local)
        : peer > 0
          ? "ONLINE PLAYER"
          : peer === 0
            ? "HOST"
            : "PLAYER";
  label(ui, who, line(inner.y + 14, 10), {
    onPanel: true,
    size: t.metrics.small,
    color: t.colors.panelDim,
    id: `c${i}.who`,
  });
  const info = ROVER_INFO[slot.rover];
  const ry = inner.y + 27;
  const arrows = local !== undefined && !slot.ready;
  if (arrows) {
    t.cursor(ui.ctx, inner.x + 1, ry + 7, "left", 4, ui.time);
    t.cursor(ui.ctx, inner.x + inner.w - 1, ry + 7, "right", 4, ui.time);
  }
  label(
    ui,
    info.name,
    { x: inner.x + 8, y: ry, w: inner.w - 16, h: 14 },
    { onPanel: true, title: true, size: t.metrics.text * 1.2, align: "center", id: `c${i}.rover` },
  );
  paragraph(
    ui,
    info.blurb,
    { x: inner.x, y: ry + 15, w: inner.w, h: 18 },
    { onPanel: true, size: t.metrics.small * 0.85, align: "center", id: `c${i}.blurb` },
  );
  info.stats.forEach((s, k) => {
    const sy = ry + 35 + k * 9;
    label(
      ui,
      s.label,
      { x: inner.x, y: sy, w: inner.w * 0.42, h: 8 },
      { onPanel: true, size: t.metrics.small * 0.8, color: t.colors.panelDim, id: `c${i}.s${k}` },
    );
    pips(ui, { x: inner.x + inner.w * 0.45, y: sy + 2, w: inner.w * 0.55, h: 4 }, s.pips, 5, color);
  });
  const by = inner.y + inner.h - 13;
  if (slot.ready) {
    const br = { x: inner.x, y: by - 1, w: inner.w, h: 14 };
    panel(ui, "button", br, { selected: true, tint: t.colors.good });
    label(ui, slot.kind === "cpu" ? "CPU READY" : "READY!", inset(br, 0, 4), {
      align: "center",
      size: t.metrics.small,
      id: `c${i}.ready`,
    });
  } else {
    chip(ui.ctx, inner.x + 4, by + 6, 3.5, color);
    label(
      ui,
      PALETTE_NAMES[slot.color],
      { x: inner.x + 10, y: by, w: inner.w - 10, h: 12 },
      { onPanel: true, size: t.metrics.small, id: `c${i}.color` },
    );
  }
}

function deviceName(app: App, seat: number): string {
  const p = app.controls.input.players[seat];
  if (!p?.connected) return "PLAYER";
  if (p.family === "keyboard") {
    const k = app.controls.input.glyph("attack", { seat }).source;
    return k ? `${p.name} (${keyLabel(k)})` : p.name;
  }
  return p.name;
}
