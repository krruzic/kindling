// The online menu: the relay's room list (GET /net/info through @kindling/net's fetchRooms, refreshed every two
// seconds), host a room, or join one by its four-letter code. Hosting or joining opens the select screen as the
// lobby; the relay comes from the Vite plugin in dev and from @kindling/server in production, on the same port.
import { fetchRooms, type RelayInfo } from "@kindling/net";
import { MenuList, NameEntry, inset, label, panel, paragraph, type MenuItem, type Screen } from "@kindling/ui";
import type { App, Frame } from "../../app/app.ts";
import { ROOM_KIND } from "../../net/session.ts";
import { dim, footer, header } from "../kit.ts";

export function onlineScreen(app: App): Screen<Frame> {
  let info: RelayInfo | null = null;
  let status = "LOOKING FOR ROOMS...";
  let fetchedAt = -1e9;
  let code: NameEntry | null = null;
  const menu = new MenuList([], { sound: (k) => app.sound.ui(k), hitId: "rooms" });
  const items = (): MenuItem[] => {
    const rooms = (info?.rooms ?? []).filter((r) => r.kind === ROOM_KIND);
    return [
      { id: "host", label: "HOST A ROOM" },
      { id: "code", label: "JOIN BY CODE" },
      ...(rooms.length ? [] : [{ id: "none", label: "NO OPEN ROOMS YET", disabled: true }]),
      ...rooms.map((r) => ({
        id: `room:${r.code}`,
        label: `${r.code}  ${r.name || "ROOM"}`,
        value: r.phase === "lobby" ? `${r.players}/${r.seats}` : "PLAYING",
        disabled: r.phase !== "lobby" || r.players >= r.seats,
      })),
    ];
  };
  const name = () => app.save.seatName(0);
  const join = (room: string) => {
    app.connect("guest", name(), room);
    app.screens.push(app.s.select());
  };
  return {
    name: "online",
    update(_dt, f) {
      if (f.now - fetchedAt > 2000) {
        fetchedAt = f.now;
        fetchRooms()
          .then((r) => {
            info = r;
            status = r.rooms.length ? "" : "NO ROOMS YET: HOST ONE!";
          })
          .catch(() => (status = "NO RELAY ON THIS SERVER"));
      }
      const id = menu.selected?.id;
      menu.items = items();
      const keep = menu.items.findIndex((x) => x.id === id);
      if (keep >= 0) menu.index = keep;
      menu.index = Math.min(menu.index, menu.items.length - 1);
      if (code) {
        const ev = code.update(f.nav);
        if (ev === "done" && code.text.length === 4) {
          const c = code.text;
          code = null;
          join(c);
        } else if (ev === "cancel") code = null;
        return;
      }
      const ev = menu.update(f.nav);
      if (ev?.type === "back") app.screens.pop();
      if (ev?.type !== "select") return;
      if (ev.item.id === "host") {
        app.connect("host", name());
        app.screens.push(app.s.select());
      } else if (ev.item.id === "code")
        code = new NameEntry("", 4, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 9, (k) => app.sound.ui(k === "key" ? "key" : k));
      else if (ev.item.id.startsWith("room:")) join(ev.item.id.slice(5));
    },
    draw(ctx, w, h) {
      const ui = app.ui;
      const t = ui.theme;
      dim(ui, w, h);
      header(ui, w, "ONLINE");
      const screen = { x: 0, y: 0, w, h };
      const lw = Math.min(200, w * 0.48);
      const rw = Math.min(150, w - lw - 50);
      const x0 = (w - lw - rw - 16) / 2;
      const left = { x: x0, y: 50, w: lw, h: 7 * 19 - 3 };
      panel(ui, "window", inset(left, -6));
      ui.debug?.box("online.window", inset(left, -6), { bounds: screen, group: "panels", ctx });
      menu.draw(ui, left, { rowH: 16, gap: 3 });
      const right = { x: x0 + lw + 16, y: 44, w: rw, h: left.h + 12 };
      panel(ui, "card", right, { seed: 6 });
      ui.debug?.box("online.card", right, { bounds: screen, group: "panels", ctx });
      const inner = inset(right, 8);
      label(ui, `PLAYING AS ${name()}`, { ...inner, h: 12 }, { onPanel: true, id: "on.name" });
      paragraph(
        ui,
        "EVERY CONTROLLER ON THIS MACHINE CAN JOIN THE ROOM. THE HOST RUNS THE MATCH; KEEP THE HOST'S TAB IN FRONT.",
        { x: inner.x, y: inner.y + 16, w: inner.w, h: 40 },
        { onPanel: true, size: t.metrics.small, id: "on.help" },
      );
      if (status)
        label(
          ui,
          status,
          { x: inner.x, y: inner.y + 60, w: inner.w, h: 11 },
          { onPanel: true, size: t.metrics.small, color: t.colors.selected, id: "on.status" },
        );
      const addrs = info?.addrs ?? [];
      if (addrs.length) {
        label(
          ui,
          "SAME NETWORK? OPEN:",
          { x: inner.x, y: inner.y + 76, w: inner.w, h: 10 },
          { onPanel: true, size: t.metrics.small, color: t.colors.panelDim, id: "on.lan" },
        );
        addrs
          .slice(0, 3)
          .forEach((a, i) =>
            label(
              ui,
              a,
              { x: inner.x, y: inner.y + 87 + i * 10, w: inner.w, h: 10 },
              { onPanel: true, size: t.metrics.small, id: `on.addr${i}` },
            ),
          );
      }
      footer(ui, w, h, [
        { glyph: app.controls.glyph("attack"), label: "SELECT" },
        { glyph: app.controls.glyph("back"), label: "BACK" },
      ]);
      if (code) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, 0, w, h);
        const r = { x: w / 2 - 110, y: 50, w: 220, h: 130 };
        code.draw(ui, r, "ROOM CODE");
        ui.debug?.box("code", r, { bounds: screen, ctx });
      }
    },
  };
}
