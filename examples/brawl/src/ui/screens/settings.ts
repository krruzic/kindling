// Options (volumes, shake, render scale, CPU level, holidays, reset) and the controller setup page: every device
// with its raw readout, single-button remaps and the guided "press every button" remap, all drawn with the ui
// package's OptionsPage / keybind rows over @kindling/input's remap sessions.
import { FAMILY_NAME } from "@kindling/input";
import { OptionsPage, inset, label, panel, paragraph, type OptionRow, type Screen } from "@kindling/ui";
import type { App, Frame } from "../../app/app.ts";
import { ACTION_NAMES, REMAP_STEPS, type Action } from "../../app/controls.ts";
import { OPTION_ROWS, type Options } from "../../app/save.ts";
import { dim, footer, header } from "../kit.ts";

const BLURBS: Record<string, string> = {
  music: "MUSIC VOLUME. EVERY TRACK IS SYNTHESISED WHEN THE GAME STARTS.",
  sfx: "SOUND EFFECTS. HITS, DASHES, SLAMS AND THE ANNOUNCER BEEPS.",
  ambience: "WIND AND CROWD UNDER EVERYTHING.",
  shake: "HOW HARD THE CAMERA SHAKES ON BIG HITS.",
  scale: "AUTO STEPS THE 3D RESOLUTION DOWN WHEN FRAMES RUN LONG, AND BACK UP WHEN THERE IS ROOM.",
  holidays: "SEASONAL DRESSING, LIKE SNOW AND LIGHTS IN DECEMBER. NEVER CHANGES THE GAME ITSELF.",
  cpu: "HOW WELL NEWLY ADDED CPU PLAYERS FIGHT.",
  reset: "FORGET EVERY NAME, RECORD, OPTION AND CONTROLLER SETUP.",
};

export function optionsScreen(app: App): Screen<Frame> {
  const o = () => app.save.data.options;
  const set = (k: keyof Options, v: number) => {
    o()[k] = v;
    app.save.write();
    app.applyOptions();
  };
  const row = (k: keyof Options): OptionRow => {
    const r = OPTION_ROWS.find((x) => x.key === k)!;
    if (r.values.length > 4)
      return {
        id: k,
        label: r.label,
        kind: "slider",
        min: 0,
        max: 10,
        step: 1,
        get: () => o()[k],
        set: (v) => set(k, v),
        blurb: BLURBS[k],
      };
    if (r.values.length === 2)
      return {
        id: k,
        label: r.label,
        kind: "toggle",
        get: () => !!o()[k],
        set: (v) => set(k, v ? 1 : 0),
        blurb: BLURBS[k],
      };
    return {
      id: k,
      label: r.label,
      kind: "choice",
      options: r.values.map((v) => (r.fmt ? r.fmt(v) : String(v))),
      get: () => Math.max(0, r.values.indexOf(o()[k])),
      set: (i) => set(k, r.values[i]),
      blurb: BLURBS[k],
    };
  };
  const page = new OptionsPage(
    [
      row("music"),
      row("sfx"),
      row("ambience"),
      row("shake"),
      row("scale"),
      row("cpu"),
      row("holidays"),
      {
        id: "reset",
        label: "RESET SAVE",
        kind: "action",
        danger: true,
        blurb: BLURBS.reset,
        run: () =>
          app.screens.push(
            app.s.confirm(
              "RESET SAVE?",
              "EVERY NAME, RECORD, OPTION AND CONTROLLER SETUP WILL BE FORGOTTEN.",
              () => {
                app.save.store.reset();
                app.applyOptions();
              },
              { danger: true, yes: "RESET", no: "KEEP" },
            ),
          ),
      },
    ],
    (k) => app.sound.ui(k),
  );
  return {
    name: "options",
    update(_dt, f) {
      const ev = page.update(f.nav);
      if (ev?.type === "back") app.screens.pop();
    },
    draw(ctx, w, h) {
      const ui = app.ui;
      dim(ui, w, h);
      header(ui, w, "OPTIONS");
      const pw = Math.min(300, w - 40);
      const r = { x: (w - pw) / 2, y: 48, w: pw, h: 8 * 17 - 3 };
      panel(ui, "window", inset(r, -6));
      ui.debug?.box("options.window", inset(r, -6), { bounds: { x: 0, y: 0, w, h }, group: "panels", ctx });
      page.draw(ui, r, { rowH: 14, gap: 3 });
      const b = { x: r.x - 6, y: r.y + r.h + 10, w: r.w + 12, h: 22 };
      panel(ui, "card", b, { seed: 2 });
      ui.debug?.box("options.blurb", b, { bounds: { x: 0, y: 0, w, h: h - 18 }, group: "panels", ctx });
      paragraph(ui, page.focused?.blurb ?? "", inset(b, 4, 8), {
        onPanel: true,
        size: ui.theme.metrics.small,
        align: "center",
        id: "blurb",
      });
      footer(ui, w, h, [
        { glyph: app.controls.glyph("up"), label: "CHOOSE" },
        { glyph: app.controls.glyph("left"), label: "CHANGE" },
        { glyph: app.controls.glyph("back"), label: "BACK" },
      ]);
    },
  };
}

export function controlsScreen(app: App): Screen<Frame> {
  const input = app.controls.input;
  let dev = Number(app.params.get("device") ?? 0);
  const devices = () => input.deviceList();
  const current = () => devices()[Math.min(dev, devices().length - 1)];
  const keyRow = (a: Action): OptionRow => ({
    id: a,
    label: ACTION_NAMES[a],
    kind: "keybind",
    get: () => {
      const d = current();
      return d ? input.glyph(a, { device: d.handle, mode: "physical" }) : null;
    },
    listening: () => !!input.session?.active && input.session.action === a && !input.session.guided,
    rebind: () => {
      const d = current();
      if (d) input.startRemap(d.handle, [a]);
    },
  });
  const page = new OptionsPage(
    [
      {
        id: "device",
        label: "DEVICE",
        kind: "choice",
        get: () => Math.min(dev, Math.max(0, devices().length - 1)),
        set: (i) => (dev = i),
        get options() {
          return devices().map((d) => d.name);
        },
      } as OptionRow,
      ...REMAP_STEPS.map(keyRow),
      {
        id: "guided",
        label: "SET UP EVERY BUTTON",
        kind: "action",
        run: () => {
          const d = current();
          if (d) input.startRemap(d.handle, REMAP_STEPS);
        },
      },
      {
        id: "reset",
        label: "RESET THIS DEVICE",
        kind: "action",
        run: () => current() && input.resetBindings(current()!.key),
      },
      { id: "hid", label: "FIND USB / GAMECUBE PADS", kind: "action", run: () => app.controls.findHid() },
    ],
    (k) => app.sound.ui(k),
    "pads",
  );
  return {
    name: "controls",
    enter: () => (input.joining = false),
    exit: () => input.cancelRemap(),
    update(_dt, f) {
      if (input.session?.active) return;
      const ev = page.update(f.nav);
      if (ev?.type === "back") app.screens.pop();
    },
    draw(ctx, w, h) {
      const ui = app.ui;
      const t = ui.theme;
      dim(ui, w, h, 0.7);
      header(ui, w, "CONTROLLERS");
      const screen = { x: 0, y: 0, w, h };
      const gap = 14;
      const lw = Math.min(210, (w - 40 - gap) * 0.55);
      const rw = Math.min(170, w - 40 - gap - lw);
      const x0 = (w - lw - rw - gap) / 2;
      const left = { x: x0, y: 48, w: lw, h: 9 * 17 - 3 };
      panel(ui, "window", inset(left, -6));
      ui.debug?.box("pads.window", inset(left, -6), { bounds: screen, group: "panels", ctx });
      page.draw(ui, left, { rowH: 14, gap: 3, controlW: lw * 0.5 });
      // Raw readout of the selected device
      const right = { x: x0 + lw + gap, y: 42, w: rw, h: left.h + 12 };
      panel(ui, "card", right, { seed: 4 });
      ui.debug?.box("pads.raw", right, { bounds: screen, group: "panels", ctx });
      const inner = inset(right, 7);
      const d = current();
      const dbg = d ? input.debug().find((x) => x.handle === d.handle) : undefined;
      label(ui, d ? d.name : "NO DEVICE", { ...inner, h: 12 }, { onPanel: true, id: "raw.name" });
      label(
        ui,
        d
          ? `${FAMILY_NAME[d.family]}${dbg && dbg.seat >= 0 ? `  ·  P${dbg.seat + 1}` : ""}${dbg?.custom ? "  ·  CUSTOM" : ""}`
          : "",
        { ...inner, y: inner.y + 12, h: 10 },
        {
          onPanel: true,
          size: t.metrics.small,
          color: t.colors.panelDim,
          id: "raw.family",
        },
      );
      const lines: string[] = [];
      if (dbg) {
        lines.push(
          `STICK ${dbg.stick[0].toFixed(2)} ${dbg.stick[1].toFixed(2)}  C ${dbg.stick[2].toFixed(2)} ${dbg.stick[3].toFixed(2)}`,
        );
        if (dbg.kind !== "keyboard") lines.push(`TRIGGERS L ${dbg.lt.toFixed(2)}  R ${dbg.rt.toFixed(2)}`);
        const held = REMAP_STEPS.filter((a) => dbg.held[a]).map((a) => ACTION_NAMES[a]);
        lines.push(`HELD: ${held.length ? held.join(", ") : "-"}`);
        for (const s of dbg.sources.filter((s) => s.on || s.analogTrigger).slice(0, 7))
          lines.push(`${s.label}: ${s.text || (s.on ? "ON" : "")}`.toUpperCase());
      }
      lines
        .slice(0, 10)
        .forEach((l, i) =>
          label(
            ui,
            l,
            { x: inner.x, y: inner.y + 26 + i * 10, w: inner.w, h: 10 },
            { onPanel: true, size: t.metrics.small * 0.9, id: `raw.${i}` },
          ),
        );
      const s = input.session;
      if (s?.active && s.guided) {
        c_overlay(
          app,
          w,
          h,
          s.action ? ACTION_NAMES[s.action] : "",
          s.step,
          s.steps.length,
          s.hold,
          s.timeLeft(performance.now() / 1000),
        );
      }
      footer(ui, w, h, [
        { glyph: app.controls.glyph("attack"), label: "REMAP" },
        { glyph: app.controls.glyph("left"), label: "DEVICE" },
        { glyph: app.controls.glyph("back"), label: "BACK" },
      ]);
    },
  };
}

/** The guided remap prompt: which action, progress, and the hold-to-skip ring. */
function c_overlay(
  app: App,
  w: number,
  h: number,
  action: string,
  step: number,
  steps: number,
  hold: number,
  left: number,
): void {
  const ui = app.ui;
  const c = ui.ctx;
  c.fillStyle = "rgba(0,0,0,0.55)";
  c.fillRect(0, 0, w, h);
  const r = { x: w / 2 - 110, y: h / 2 - 48, w: 220, h: 96 };
  panel(ui, "dialog", r);
  ui.debug?.box("remap", r, { bounds: { x: 0, y: 0, w, h }, ctx: c });
  const inner = inset(r, 10);
  label(
    ui,
    `STEP ${step + 1} OF ${steps}`,
    { ...inner, h: 11 },
    { onPanel: true, size: ui.theme.metrics.small, align: "center", id: "remap.step" },
  );
  label(
    ui,
    `PRESS ${action}`,
    { ...inner, y: inner.y + 14, h: 20 },
    { onPanel: true, size: ui.theme.metrics.title, align: "center", title: true, id: "remap.action" },
  );
  const cx = w / 2;
  const cy = inner.y + 50;
  c.strokeStyle = "rgba(60,30,10,0.35)";
  c.lineWidth = 3;
  c.beginPath();
  c.arc(cx, cy, 9, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = ui.theme.colors.selected;
  c.beginPath();
  c.arc(cx, cy, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, hold));
  c.stroke();
  label(
    ui,
    `HOLD ANY BUTTON TO SKIP  ·  ${Math.ceil(left)}S`,
    { ...inner, y: inner.y + inner.h - 11, h: 11 },
    {
      onPanel: true,
      size: ui.theme.metrics.small,
      align: "center",
      color: ui.theme.colors.panelDim,
      id: "remap.hint",
    },
  );
}
