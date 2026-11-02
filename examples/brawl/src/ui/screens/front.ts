// Front-end screens: title (over the attract-mode match), main menu, credits (from the licence registry) and the
// generic confirm / message dialogs.
import { Dialog, MenuList, inset, label, panel, paragraph, type Screen, type ScreenPhase } from "@kindling/ui";
import { winRateText } from "@kindling/save";
import type { App, Frame } from "../../app/app.ts";
import { ROVER_INFO } from "../rovers.ts";
import { dim, footer, header } from "../kit.ts";
import CREDITS from "../../../assets.credits.json" with { type: "json" };

export function titleScreen(app: App): Screen<Frame> {
  let t = 0;
  return {
    name: "title",
    enter: () => (t = 0),
    update(dt, f) {
      t += dt;
      const any = f.nav.a || f.nav.b || Object.values(f.nav.pressed).some(Boolean);
      if (any && t > 0.3) {
        app.sound.ui("ok");
        app.screens.replace(app.s.menu());
      }
    },
    draw(ctx, w, h) {
      const ui = app.ui;
      dim(ui, w, h, 0.35);
      const th = ui.theme;
      const tf = th.titleFont ?? th.font;
      const size = Math.min(h * 0.3, (w * 0.7 * 10) / tf.measure("BRAWL", 10));
      const tw = tf.measure("BRAWL", size);
      const y = h * 0.16;
      ctx.save();
      const wob = Math.sin(app.time * 1.6) * 0.012;
      ctx.translate(w / 2, y + size * 0.5);
      ctx.rotate(-0.04 + wob);
      tf.draw(ctx, "BRAWL", -tw / 2, -tf.lineHeight(size) / 2, size, {
        color: "#f0c450",
        outline: "#3c2408",
        shadow: "rgba(0,0,0,0.7)",
        bevel: true,
      });
      ctx.restore();
      ui.debug?.box(
        "logo",
        { x: (w - tw) / 2, y, w: tw, h: tf.lineHeight(size) },
        { bounds: { x: 0, y: 0, w, h }, group: "title", ctx },
      );
      const sub = { x: w / 2 - 110, y: y + tf.lineHeight(size) + 2, w: 220, h: 14 };
      label(ui, "ROVER SUMO  ·  1-4 PLAYERS  ·  COUCH + ONLINE", sub, {
        align: "center",
        size: th.metrics.small,
        color: th.colors.dim,
        id: "subtitle",
      });
      ui.debug?.box("subtitle", sub, { group: "title", ctx });
      if (Math.floor(app.time * 2.2) % 3 !== 0) {
        const pr = { x: w / 2 - 90, y: h * 0.7, w: 180, h: 16 };
        label(ui, "PRESS ANY BUTTON", pr, { align: "center", size: th.metrics.text * 1.2, id: "press" });
        ui.debug?.box("press", pr, { group: "title", ctx });
      }
      footer(ui, w, h, [
        { glyph: app.controls.glyph("attack"), label: "START" },
        { glyph: { label: "KINDLING", family: "keyboard", color: "#e8b84a" }, label: "ENGINE EXAMPLE" },
      ]);
    },
  };
}

export function menuScreen(app: App): Screen<Frame> {
  const items = [
    { id: "local", label: "LOCAL PLAY" },
    { id: "online", label: "ONLINE" },
    { id: "controls", label: "CONTROLLERS" },
    { id: "options", label: "OPTIONS" },
    { id: "credits", label: "CREDITS" },
  ];
  const menu = new MenuList(items, { sound: (k) => app.sound.ui(k), hitId: "main" });
  const blurb: Record<string, string> = {
    local:
      "UP TO FOUR PLAYERS ON ONE SCREEN: PADS, GAMECUBE ADAPTERS AND TWO KEYBOARD HALVES. FILL EMPTY SEATS WITH CPUS.",
    online: "HOST A ROOM OR JOIN ONE BY CODE. BRING YOUR WHOLE COUCH: EVERY PAD ON EVERY MACHINE GETS A SEAT.",
    controls: "SEE WHAT EVERY CONTROLLER SENDS, REMAP ONE BUTTON OR WALK THROUGH THEM ALL.",
    options: "VOLUMES, SCREEN SHAKE, RENDER SCALE, CPU LEVEL AND HOLIDAY TWEAKS.",
    credits: "WHO MADE WHAT, AND UNDER WHICH LICENCE.",
  };
  return {
    name: "menu",
    enter: () => app.controls.nav.reset(),
    update(_dt, f) {
      const ev = menu.update(f.nav);
      if (ev?.type === "back") app.screens.replace(app.s.title());
      if (ev?.type !== "select") return;
      const id = ev.item.id;
      if (id === "local") {
        app.leaveOnline();
        app.screens.push(app.s.select());
      } else if (id === "online") app.screens.push(app.s.online());
      else if (id === "controls") app.screens.push(app.s.controls());
      else if (id === "options") app.screens.push(app.s.options());
      else if (id === "credits") app.screens.push(app.s.credits());
    },
    draw(ctx, w, h) {
      const ui = app.ui;
      dim(ui, w, h);
      header(ui, w, "BRAWL");
      const screen = { x: 0, y: 0, w, h };
      const left = { x: Math.max(16, w * 0.08), y: 56, w: 150, h: 97 };
      panel(ui, "window", inset(left, -6));
      ui.debug?.box("menu.window", inset(left, -6), { bounds: screen, group: "panels", ctx });
      menu.draw(ui, left);
      const rw = Math.min(190, w - left.x - left.w - 40);
      const right = { x: w - rw - Math.max(16, w * 0.08), y: 50, w: rw, h: 115 };
      panel(ui, "card", right, { seed: 3 });
      ui.debug?.box("menu.card", right, { bounds: screen, group: "panels", ctx });
      const inner = inset(right, 8);
      const id = menu.selected?.id ?? "local";
      label(
        ui,
        menu.selected?.label ?? "",
        { ...inner, h: 13 },
        { onPanel: true, size: ui.theme.metrics.text * 1.1, id: "menu.blurb.title" },
      );
      paragraph(
        ui,
        blurb[id],
        { x: inner.x, y: inner.y + 15, w: inner.w, h: 38 },
        { onPanel: true, size: ui.theme.metrics.small, id: "menu.blurb" },
      );
      // records per rover
      const ry = inner.y + 56;
      label(
        ui,
        "YOUR RECORDS",
        { x: inner.x, y: ry, w: inner.w, h: 11 },
        { onPanel: true, size: ui.theme.metrics.small, color: ui.theme.colors.panelDim, id: "rec.head" },
      );
      Object.entries(ROVER_INFO).forEach(([k, info], i) => {
        const r = app.save.rovers.get(k);
        const row = { x: inner.x, y: ry + 12 + i * 10, w: inner.w, h: 10 };
        label(
          ui,
          info.name,
          { ...row, w: row.w * 0.5 },
          { onPanel: true, size: ui.theme.metrics.small, id: `rec.${k}` },
        );
        label(
          ui,
          `${r.w}-${r.l}  ${winRateText(r)}`,
          { ...row, x: row.x + row.w * 0.5, w: row.w * 0.5 },
          { onPanel: true, size: ui.theme.metrics.small, align: "right", id: `rec.${k}.v` },
        );
      });
      footer(ui, w, h, [
        { glyph: app.controls.glyph("attack"), label: "SELECT" },
        { glyph: app.controls.glyph("back"), label: "BACK" },
      ]);
    },
  };
}

export function creditsScreen(app: App): Screen<Frame> {
  const lines = [
    ...CREDITS.entries.map(
      (e) => `${e.title.toUpperCase()}${e.author ? ` · ${e.author.toUpperCase()}` : ""} · ${e.licence}`,
    ),
  ];
  return {
    name: "credits",
    update(_dt, f) {
      if (f.nav.b || f.nav.a) {
        app.sound.ui("back");
        app.screens.pop();
      }
    },
    draw(ctx, w, h) {
      const ui = app.ui;
      dim(ui, w, h);
      header(ui, w, "CREDITS");
      const r = { x: w / 2 - Math.min(170, w / 2 - 16), y: 46, w: Math.min(340, w - 32), h: h - 80 };
      panel(ui, "card", r, { seed: 5 });
      ui.debug?.box("credits.card", r, { bounds: { x: 0, y: 0, w, h }, ctx });
      const inner = inset(r, 10);
      label(
        ui,
        "BRAWL · A KINDLING ENGINE EXAMPLE",
        { ...inner, h: 13 },
        { onPanel: true, align: "center", id: "cr.title" },
      );
      paragraph(
        ui,
        "SIM, BOTS, NETCODE, UI, AUDIO, SAVES, RENDERING AND TOOLS: THE NINE @KINDLING PACKAGES. ROVER PARTS: BUILT BY A BLENDER SCRIPT (TOOLS/PARTS.PY). SOUND AND MUSIC: SYNTHESISED BY CODE. NO AI-GENERATED ASSETS.",
        { x: inner.x, y: inner.y + 18, w: inner.w, h: 42 },
        { onPanel: true, size: ui.theme.metrics.small, align: "center", id: "cr.body" },
      );
      lines.forEach((l, i) => {
        const lr = { x: inner.x, y: inner.y + 66 + i * 12, w: inner.w, h: 11 };
        if (lr.y + lr.h > inner.y + inner.h) return;
        label(ui, l, lr, { onPanel: true, size: ui.theme.metrics.small, align: "center", id: `cr.${i}` });
      });
      footer(ui, w, h, [{ glyph: app.controls.glyph("back"), label: "BACK" }]);
    },
  };
}

/** A modal dialog over the current screen. */
export function dialogScreen(app: App, d: Dialog, on: (index: number) => void, cancel = -1): Screen<Frame> {
  return {
    name: "dialog",
    opaque: false,
    update(_dt, f) {
      const ev = d.update(f.nav);
      if (!ev) return;
      app.screens.pop();
      if (ev.type === "choose") on(ev.index);
      else if (cancel >= 0) on(cancel);
    },
    draw(_ctx, w, h, phase: ScreenPhase) {
      void phase;
      d.draw(app.ui, w, h);
    },
  };
}

export function confirmScreen(
  app: App,
  title: string,
  body: string,
  yes: () => void,
  o: { yes?: string; no?: string; danger?: boolean } = {},
): Screen<Frame> {
  const d = new Dialog(title, body, [o.yes ?? "YES", o.no ?? "NO"], {
    initial: 1,
    danger: o.danger,
    sound: (k) => app.sound.ui(k),
  });
  return dialogScreen(app, d, (i) => i === 0 && yes());
}

export function messageScreen(app: App, title: string, body: string, ok?: () => void): Screen<Frame> {
  const d = new Dialog(title, body, ["OK"], { sound: (k) => app.sound.ui(k) });
  return dialogScreen(app, d, () => ok?.(), 0);
}
