// InputManager: reads every input device each poll into a PadState (per device and per seat), seats devices on a
// press ("press any button to join"), applies per-device remaps and runs remap sessions.
//
// Devices: browser gamepads (handle "pad-<index>", remap key = Gamepad.id, matched to a profile), PadProviders
// (WebHID GameCube adapter ports, Switch Pro / NSO GameCube pads; see ./hid) and keyboard halves ("keyboard-<n>",
// each a seat of its own; the one with `mouse: true` also gets the pointer and Mouse0/1/2 codes).
//
// Bindings: the game names its actions; each family's defaults bind them to canonical PadButtons, which a device's
// profile turns into its sources. A remap (RemapStore, keyed by device key) overrides them per device and applies
// again whenever that device reconnects.
//
// Seats: a device takes a free seat when it presses a (non-axis) button while `joining` is on; a disconnected
// device's seat remembers its key, so the same pad reconnecting gets that seat back first. A released device must
// let go of everything before it can rejoin, and the press that joins doesn't act (unless joinPressCounts).
//
// Browser-only bits are injected: `gamepads` (default navigator.getGamepads), a KeyboardInput (wire it with
// attachDom) and providers. Tests pass fakes and explicit `now` seconds to poll().
import { Device } from "./device.ts";
import { buttonFace, cleanPadName, detectFamily, familyColor, keyLabel } from "./families.ts";
import { KeyboardInput } from "./keyboard.ts";
import { axisSourceId, BUILTIN_PROFILES, profileFor, profileSources, type Profile } from "./profiles.ts";
import { rebind, RemapSession, RemapStore, type RemapHooks, type RemapOptions } from "./remap.ts";
import { radialDeadzone, type Dir4 } from "./sticks.ts";
import { triggerText } from "./trigger.ts";
import type { GlyphShape } from "./families.ts";
import type { Bindings, GamepadLike, PadButton, PadFamily, PadState } from "./types.ts";
import { emptyFlags, emptyPad, STANDARD_BUTTONS } from "./types.ts";

export type FamilyDefaults<A extends string> = { default: Partial<Record<A, PadButton[]>> } & Partial<
  Record<Exclude<PadFamily, "keyboard">, Partial<Record<A, PadButton[]>>>
>;

export interface KeyboardLayout<A extends string> {
  name?: string;
  /** Movement keys (the left stick). */
  stick: Record<Dir4, string[]>;
  /** Second stick (C-stick), optional. */
  cstick?: Record<Dir4, string[]>;
  /** KeyboardEvent.code per action; "Mouse0" / "Mouse1" / "Mouse2" on the half that owns the mouse. */
  buttons: Partial<Record<A, string[]>>;
  mouse?: boolean;
}

/** A pad read by something other than the Gamepad API (WebHID), already in canonical buttons. */
export interface ExternalPad {
  handle: string;
  key: string;
  name: string;
  family: PadFamily;
  profile: string;
  buttons: Partial<Record<PadButton, { digital?: boolean; analog?: number }>>;
  stick: [number, number];
  cstick: [number, number];
  /** Buttons whose analog channel is a real trigger (calibrates from frame one, distrusts a stuck click). */
  analog?: PadButton[];
}

export interface PadProvider {
  read(gamepads: readonly (GamepadLike | null)[]): ExternalPad[];
  /** Gamepads this provider already reads: skipped on the Gamepad API path so they don't join twice. */
  hides?(pad: GamepadLike): boolean;
  debug?(): string;
}

export interface ActionLabel {
  label: string;
  color?: string;
}

export interface InputOptions<A extends string> {
  actions: readonly A[];
  /** Default bindings per family (merged over `default`). */
  bindings: FamilyDefaults<A>;
  seats?: number;
  keyboards?: KeyboardLayout<A>[];
  /** Extra profiles, matched before the built-ins. */
  profiles?: Profile[];
  stickDeadzone?: number;
  /** Analog press threshold per canonical button (default lt / rt 0.3, other analog 0.5). */
  triggerOn?: Partial<Record<PadButton, number>>;
  gamepads?: () => readonly (GamepadLike | null)[];
  providers?: PadProvider[];
  keyboard?: KeyboardInput;
  remaps?: RemapStore | RemapHooks;
  /** Only presses of these actions join a seat (default: any button). */
  joinActions?: A[];
  /** The press that seats a device also acts (default false: it's swallowed until released). */
  joinPressCounts?: boolean;
  /** The game's own glyph per action (prompts show these by default). */
  labels?: Partial<Record<A, ActionLabel>>;
}

export type LeaveReason = "disconnect" | "release";

export interface Glyph {
  label: string;
  color: string;
  family: PadFamily;
  /** game: the game's own letter; button: a physical pad button; key: a keyboard key; none: unbound. */
  kind: "game" | "button" | "key" | "none";
  shape?: GlyphShape;
  source?: string;
}

export interface GlyphOptions {
  /** "game" (default): the game's letters on pads; "physical": the bound button's own label. */
  mode?: "game" | "physical";
  /** Whose binding (default: the device used last). */
  seat?: number;
  device?: string;
  /** Family to assume without a device (default xbox). */
  family?: PadFamily;
  /** Keyboard devices show key names even in "game" mode (default true). */
  keyboardKeys?: boolean;
}

export interface SourceDebug {
  id: string;
  label: string;
  on: boolean;
  button?: PadButton;
  axis: boolean;
  digital?: boolean;
  analog?: number;
  rest: number;
  peak: number;
  travel: number;
  threshold: number;
  analogTrigger: boolean;
  /** Why a channel is ignored ("" = trusted). */
  note: string;
  text: string;
}

export interface DeviceDebug<A extends string> {
  handle: string;
  key: string;
  name: string;
  family: PadFamily;
  profile: string;
  kind: string;
  seat: number;
  custom: boolean;
  bindings: Bindings<A>;
  defaults: Bindings<A>;
  held: Record<A, boolean>;
  stick: [number, number, number, number];
  lt: number;
  rt: number;
  raw: { axes: number[]; buttons: { value: number; pressed: boolean }[] } | null;
  sources: SourceDebug[];
}

const KB_PREFIX = "keyboard-";

export class InputManager<A extends string> {
  readonly actions: readonly A[];
  /** Seat views (the seated device's state, or an empty pad). */
  readonly players: PadState<A>[];
  readonly keyboard: KeyboardInput;
  readonly remaps: RemapStore;
  /** Seat new devices on a press. */
  joining = true;
  /** Seats a new device may not take (e.g. an online guest sits there). */
  blocked: boolean[] = [];
  /** Keyboard halves take part at all. */
  keyboardEnabled = true;
  session: RemapSession<A> | null = null;
  onJoin: (seat: number, device: string) => void = () => {};
  onLeave: (seat: number, device: string, reason: LeaveReason) => void = () => {};
  labels: Partial<Record<A, ActionLabel>>;

  private devs = new Map<string, Device<A>>();
  private seats: (string | null)[];
  private lastKey: (string | null)[];
  private waitRelease = new Set<string>();
  private lastHandle: string | null = null;
  private now = 0;
  private profiles: Profile[];
  private keyboards: KeyboardLayout<A>[];

  constructor(private opts: InputOptions<A>) {
    this.actions = opts.actions;
    const n = opts.seats ?? 4;
    this.players = Array.from({ length: n }, () => emptyPad(opts.actions));
    this.seats = Array.from({ length: n }, () => null);
    this.lastKey = Array.from({ length: n }, () => null);
    this.keyboard = opts.keyboard ?? new KeyboardInput();
    this.remaps = opts.remaps instanceof RemapStore ? opts.remaps : new RemapStore(opts.remaps ?? {});
    this.profiles = [...(opts.profiles ?? []), ...BUILTIN_PROFILES];
    this.keyboards = opts.keyboards ?? [];
    this.labels = opts.labels ?? {};
    this.updateCaptured();
  }

  // ── Polling ──

  poll(now: number = performance.now() / 1000): void {
    this.now = now;
    const pads = this.opts.gamepads
      ? this.opts.gamepads()
      : typeof navigator !== "undefined" && navigator.getGamepads
        ? (navigator.getGamepads() as unknown as (GamepadLike | null)[])
        : [];
    for (const d of this.devs.values()) d.alive = false;
    const providers = this.opts.providers ?? [];
    for (const p of providers) for (const ext of p.read(pads)) this.readExternal(ext, now);
    for (const pad of pads) {
      if (!pad?.connected || providers.some((p) => p.hides?.(pad))) continue;
      this.readGamepad(pad, now);
    }
    if (this.keyboardEnabled) this.keyboards.forEach((kb, i) => this.readKeyboard(kb, i, now));
    for (const [h, d] of this.devs) if (!d.alive) this.devs.delete(h);
    this.dropMissing();

    for (const [h, d] of this.devs) {
      if (d.pressedAt(now)) this.lastHandle = h;
      d.releaseSuppressed();
    }
    if (this.session) {
      this.session.update(this.devs.get(this.session.device), now);
      if (!this.session.active) this.endSession();
    }
    if (this.joining) this.assignSeats();
    for (const d of this.devs.values()) this.updateState(d);
    for (let s = 0; s < this.seats.length; s++) {
      const h = this.seats[s];
      const d = h === null ? undefined : this.devs.get(h);
      this.players[s] = d ? d.state : emptyPad(this.actions);
    }
    this.keyboard.endFrame();
  }

  private device(handle: string, key: string, make: () => Device<A>): Device<A> {
    let d = this.devs.get(handle);
    if (!d || d.key !== key) {
      d = make();
      this.devs.set(handle, d);
    }
    d.alive = true;
    return d;
  }

  /** Default bindings for a family, in canonical buttons. */
  familyDefaults(family: PadFamily): Partial<Record<A, PadButton[]>> {
    const b = this.opts.bindings;
    return family === "keyboard" ? b.default : { ...b.default, ...(b[family] ?? {}) };
  }

  private onAt(button: PadButton | undefined, axis: boolean, prof?: Profile): number {
    const t = this.opts.triggerOn ?? {};
    if (button && prof?.thresholds?.[button] !== undefined) return prof.thresholds[button]!;
    if (button && t[button] !== undefined) return t[button]!;
    if (button === "lt" || button === "rt" || axis) return 0.3;
    return 0.5;
  }

  private readExternal(p: ExternalPad, now: number): void {
    const d = this.device(p.handle, p.key, () => {
      const canon = this.familyDefaults(p.family);
      const defaults = {} as Bindings<A>;
      for (const a of this.actions) defaults[a] = (canon[a] ?? []).filter((b) => p.buttons[b] !== undefined);
      return new Device(p.handle, p.key, p.name, p.family, p.profile, "hid", defaults, this.actions);
    });
    d.name = p.name;
    for (const [b, s] of Object.entries(p.buttons) as [PadButton, { digital?: boolean; analog?: number }][]) {
      const analog = !!p.analog?.includes(b);
      d.read(b, buttonFace(p.family, b).label, s, now, { button: b, analog, onAt: this.onAt(b, false) });
    }
    const dz = this.opts.stickDeadzone ?? 0.2;
    d.stick = [...radialDeadzone(p.stick[0], p.stick[1], dz), ...radialDeadzone(p.cstick[0], p.cstick[1], dz)];
    d.lt = Math.min(1, d.sources.get("lt")?.trig.travel ?? 0);
    d.rt = Math.min(1, d.sources.get("rt")?.trig.travel ?? 0);
  }

  private readGamepad(pad: GamepadLike, now: number): void {
    const prof = profileFor(pad, this.profiles);
    const standard = pad.mapping === "standard";
    const handle = `pad-${pad.index}`;
    const d = this.device(handle, pad.id, () => {
      const family = prof.family ?? detectFamily(pad.id, pad.mapping);
      const canon = this.familyDefaults(family);
      const defaults = {} as Bindings<A>;
      for (const a of this.actions) defaults[a] = (canon[a] ?? []).flatMap((b) => profileSources(prof, b));
      const port = /port (\d)/i.exec(pad.id)?.[1];
      const name = family === "gc" && port ? `GAMECUBE PORT ${port}` : cleanPadName(pad.id);
      return new Device(handle, pad.id, name, family, prof.id, "gamepad", defaults, this.actions);
    });
    d.raw = { axes: [...pad.axes], buttons: pad.buttons.map((b) => ({ value: b.value, pressed: b.pressed })) };
    // Source -> canonical button, from the profile (or the standard order).
    const canonOf = new Map<string, PadButton>();
    for (const b of STANDARD_BUTTONS) for (const s of profileSources(prof, b)) if (!canonOf.has(s)) canonOf.set(s, b);
    pad.buttons.forEach((btn, i) => {
      const id = `b${i}`;
      const b = canonOf.get(id) ?? (standard ? STANDARD_BUTTONS[i] : undefined);
      const label = b && (standard || prof.family || canonOf.has(id)) ? buttonFace(d.family, b).label : `BTN ${i}`;
      // .value only: browsers derive .pressed from it for analog buttons (a trigger resting part-pressed would
      // read pressed forever); plain buttons report 0 / 1.
      d.read(id, label, { analog: btn.value }, now, { button: b, onAt: this.onAt(b, false, prof) });
    });
    const sticks = new Set([prof.stick.x.axis, prof.stick.y.axis, prof.cstick.x.axis, prof.cstick.y.axis]);
    const axisRefs = Object.values(prof.axisButtons ?? {}).flat();
    pad.axes.forEach((raw, i) => {
      if (sticks.has(i)) return;
      const v = Math.max(-1, Math.min(1, raw));
      const v0 = (d.axisStart[i] ??= v);
      for (const dir of ["+", "-"] as const) {
        const id = `a${i}${dir}`;
        const b = canonOf.get(id);
        const ref = axisRefs.find((r) => axisSourceId(r) === id);
        d.read(
          id,
          b ? buttonFace(d.family, b).label : `AXIS ${i}${dir}`,
          { analog: dir === "+" ? (v + 1) / 2 : (1 - v) / 2, calibrate: dir === "+" ? v >= v0 - 0.02 : v <= v0 + 0.02 },
          now,
          { button: b, axis: true, analog: true, onAt: ref?.threshold ?? this.onAt(b, true, prof) },
        );
      }
    });
    const axis = (r: { axis: number; invert?: boolean; scale?: number }) =>
      Math.max(-1, Math.min(1, (pad.axes[r.axis] ?? 0) * (r.invert ? -1 : 1) * (r.scale ?? 1)));
    const dz = this.opts.stickDeadzone ?? 0.2;
    d.stick = [
      ...radialDeadzone(axis(prof.stick.x), axis(prof.stick.y), dz),
      ...radialDeadzone(axis(prof.cstick.x), axis(prof.cstick.y), dz),
    ];
    const travel = (b: PadButton) =>
      Math.min(1, Math.max(0, ...profileSources(prof, b).map((s) => d.sources.get(s)?.trig.travel ?? 0)));
    d.lt = travel("lt");
    d.rt = travel("rt");
  }

  private readKeyboard(kb: KeyboardLayout<A>, i: number, now: number): void {
    const handle = `${KB_PREFIX}${i + 1}`;
    const d = this.device(handle, handle, () => {
      const defaults = {} as Bindings<A>;
      for (const a of this.actions) defaults[a] = [...(kb.buttons[a] ?? [])];
      const name =
        kb.name ?? (this.keyboards.length > 1 ? `KEYBOARD ${i + 1}` : kb.mouse ? "KEYBOARD + MOUSE" : "KEYBOARD");
      return new Device(handle, handle, name, "keyboard", "keyboard", "keyboard", defaults, this.actions);
    });
    const k = this.keyboard;
    const b = this.bindingsOf(d);
    const codes = new Set<string>([...Object.values<string[]>(b).flat(), ...Object.values(kb.stick).flat()]);
    if (kb.cstick) for (const c of Object.values(kb.cstick).flat()) codes.add(c);
    // Any key down becomes a source, so a remap capture can take keys the layout doesn't use yet.
    for (const c of k.down()) if (kb.mouse || !c.startsWith("Mouse")) codes.add(c);
    for (const c of d.sources.keys()) codes.add(c);
    for (const c of codes) d.read(c, keyLabel(c), { digital: k.isDown(c) }, now);
    const vec = (dirs: Record<Dir4, string[]>): [number, number] => {
      const on = (dir: Dir4) => dirs[dir].some((c) => k.isDown(c));
      let x = (on("right") ? 1 : 0) - (on("left") ? 1 : 0);
      let y = (on("down") ? 1 : 0) - (on("up") ? 1 : 0);
      const m = Math.hypot(x, y);
      if (m > 1) [x, y] = [x / m, y / m];
      return [x, y];
    };
    d.stick = [...vec(kb.stick), ...(kb.cstick ? vec(kb.cstick) : [0, 0])] as [number, number, number, number];
    if (kb.mouse) d.state.pointer = { ...k.mouse };
  }

  private updateCaptured(): void {
    const c = this.keyboard.captured;
    c.clear();
    for (const kb of this.keyboards) {
      for (const codes of Object.values<string[] | undefined>(kb.buttons)) for (const x of codes ?? []) c.add(x);
      for (const x of Object.values(kb.stick).flat()) c.add(x);
      if (kb.cstick) for (const x of Object.values(kb.cstick).flat()) c.add(x);
    }
    for (const [key, b] of Object.entries(this.remaps.data))
      if (key.startsWith(KB_PREFIX)) for (const srcs of Object.values(b)) for (const x of srcs) c.add(x);
  }

  /** Replaces the keyboard halves (an options page). Custom keyboard remaps still apply on top. */
  setKeyboards(kbs: KeyboardLayout<A>[]): void {
    this.keyboards = kbs;
    for (const h of [...this.devs.keys()]) if (h.startsWith(KB_PREFIX)) this.devs.delete(h);
    this.keyboard.blur();
    this.updateCaptured();
  }

  get keyboardLayouts(): readonly KeyboardLayout<A>[] {
    return this.keyboards;
  }

  private updateState(d: Device<A>): void {
    const st = d.state;
    const blank = this.session?.device === d.handle;
    const b = this.bindingsOf(d);
    const held = emptyFlags(this.actions);
    if (!blank) for (const a of this.actions) held[a] = b[a].some((s) => d.live(s));
    const pressed = emptyFlags(this.actions);
    const released = emptyFlags(this.actions);
    for (const a of this.actions) {
      pressed[a] = held[a] && !st.held[a];
      released[a] = !held[a] && st.held[a];
    }
    st.held = held;
    st.pressed = pressed;
    st.released = released;
    [st.stickX, st.stickY, st.cX, st.cY] = blank ? [0, 0, 0, 0] : d.stick;
    st.lt = blank ? 0 : d.lt;
    st.rt = blank ? 0 : d.rt;
    st.connected = true;
    st.device = d.handle;
    st.key = d.key;
    st.name = d.name;
    st.family = d.family;
    st.profile = d.profile;
  }

  // ── Seats ──

  private dropMissing(): void {
    for (let s = 0; s < this.seats.length; s++) {
      const h = this.seats[s];
      if (h === null || this.devs.has(h)) continue;
      this.seats[s] = null;
      this.onLeave(s, h, "disconnect");
    }
    for (const h of this.waitRelease) if (!this.devs.has(h)) this.waitRelease.delete(h);
  }

  /** Whether a device is pressing something that should seat it. */
  private wantsSeat(d: Device<A>): boolean {
    const join = this.opts.joinActions;
    if (join) {
      const b = this.bindingsOf(d);
      return join.some((a) => b[a].some((s) => !!d.sources.get(s)?.on));
    }
    if (d.kind === "keyboard") {
      const b = this.bindingsOf(d);
      return this.actions.some((a) => b[a].some((s) => !!d.sources.get(s)?.on));
    }
    return d.anyOn();
  }

  private assignSeats(): void {
    for (const [h, d] of this.devs) {
      if (this.seats.includes(h) || this.session?.device === h) continue;
      const on = this.wantsSeat(d) || d.anyOn();
      if (this.waitRelease.has(h)) {
        if (!on) this.waitRelease.delete(h);
        continue;
      }
      if (!this.wantsSeat(d)) continue;
      this.join(h);
    }
  }

  /** Seats a device (in `seat`, or the seat it last held, or the first free one). Returns the seat or -1. */
  join(handle: string, seat?: number): number {
    const d = this.devs.get(handle);
    if (!d || this.seats.includes(handle)) return this.seats.indexOf(handle);
    const free = (i: number) => this.seats[i] === null && !this.blocked[i];
    let s = seat !== undefined && free(seat) ? seat : -1;
    if (s < 0) s = this.seats.findIndex((_, i) => free(i) && this.lastKey[i] === d.key);
    if (s < 0) s = this.seats.findIndex((_, i) => free(i) && this.lastKey[i] === null);
    if (s < 0) s = this.seats.findIndex((_, i) => free(i));
    if (s < 0) return -1;
    this.seats[s] = handle;
    this.lastKey[s] = d.key;
    if (!this.opts.joinPressCounts) d.suppressHeld();
    this.onJoin(s, handle);
    return s;
  }

  /** Frees a seat; its device must release every button before it can rejoin. */
  release(seat: number): void {
    const h = this.seats[seat];
    if (h === null || h === undefined) return;
    this.seats[seat] = null;
    this.lastKey[seat] = null;
    this.waitRelease.add(h);
    this.players[seat] = emptyPad(this.actions);
    this.onLeave(seat, h, "release");
  }

  /** Moves the device in seat `from` to the empty seat `to`. */
  move(from: number, to: number): boolean {
    if (from === to || this.seats[from] === null || this.seats[to] !== null) return false;
    this.seats[to] = this.seats[from];
    this.lastKey[to] = this.lastKey[from];
    this.seats[from] = null;
    this.lastKey[from] = null;
    this.players[to] = this.players[from];
    this.players[from] = emptyPad(this.actions);
    return true;
  }

  /** Empties every seat (and forgets who sat where). */
  releaseAll(): void {
    for (let s = 0; s < this.seats.length; s++) this.release(s);
    this.lastKey.fill(null);
  }

  /** Device handle in each seat (null = empty). */
  seatMap(): readonly (string | null)[] {
    return this.seats;
  }

  seatOf(handle: string): number {
    return this.seats.indexOf(handle);
  }

  seated(seat: number): boolean {
    return this.seats[seat] !== null;
  }

  // ── Devices ──

  /** Every connected device's own state (seated or not), seated first in seat order. */
  devicePads(): PadState<A>[] {
    return this.deviceList().map((d) => d.state);
  }

  deviceList(): Device<A>[] {
    const seat = (d: Device<A>) => {
      const s = this.seats.indexOf(d.handle);
      return s < 0 ? 99 : s;
    };
    return [...this.devs.values()].sort((a, b) => seat(a) - seat(b));
  }

  getDevice(handle: string): Device<A> | undefined {
    return this.devs.get(handle);
  }

  /** Handle of the device pressed most recently (prompt glyphs follow it). */
  get lastDevice(): string | null {
    return this.lastHandle && this.devs.has(this.lastHandle) ? this.lastHandle : null;
  }

  bindingsOf(d: Device<A>): Bindings<A> {
    return this.remaps.bindings(d.key, d.defaults);
  }

  // ── Remapping ──

  /** Starts binding `steps` (one action, or several in turn for the guided remap) on a device. */
  startRemap(handle: string, steps: readonly A[], opts: RemapOptions = {}): RemapSession<A> | null {
    const d = this.devs.get(handle);
    if (!d || !steps.length) return null;
    this.session?.cancel();
    if (this.session) this.endSession();
    this.session = new RemapSession(handle, steps, this.now, (a, src) => this.bind(handle, a, src), opts);
    return this.session;
  }

  cancelRemap(): void {
    if (!this.session) return;
    this.session.cancel();
    this.endSession();
  }

  private endSession(): void {
    if (this.session) this.devs.get(this.session.device)?.suppressHeld();
    this.session = null;
  }

  /** Binds `source` to `action` on a device (swapping with whatever used it) and saves. */
  bind(handle: string, action: A, source: string): void {
    const d = this.devs.get(handle);
    if (!d) return;
    this.remaps.set(d.key, rebind(d.defaults, this.bindingsOf(d), action, source));
    this.updateCaptured();
  }

  resetBindings(key: string): void {
    this.remaps.reset(key);
    this.updateCaptured();
  }

  // ── Glyphs ──

  /**
   * Prompt glyph for an action. By default pads show the GAME's letter for it (players hated seeing "BTN 11" in
   * every footer after a remap); keyboards show the bound key. mode "physical" shows the bound button's own label.
   */
  glyph(action: A, o: GlyphOptions = {}): Glyph {
    const handle = o.device ?? (o.seat !== undefined ? this.seats[o.seat] : this.lastDevice);
    const d = handle ? this.devs.get(handle) : undefined;
    const family = d?.family ?? o.family ?? "xbox";
    if (family === "keyboard" && o.keyboardKeys !== false) {
      const code = d ? this.bindingsOf(d)[action][0] : this.keyboards[0]?.buttons[action]?.[0];
      return code
        ? { label: keyLabel(code), color: familyColor("keyboard", ""), family, kind: "key", source: code }
        : { label: "-", color: familyColor("keyboard", ""), family, kind: "none" };
    }
    if ((o.mode ?? "game") === "game") {
      const l = this.labels[action];
      return { label: l?.label ?? action.toUpperCase(), color: l?.color ?? "#5a5a64", family, kind: "game" };
    }
    if (d) {
      const id = this.bindingsOf(d)[action][0];
      const src = id ? d.sources.get(id) : undefined;
      if (!id) return { label: "-", color: "#5a5a64", family, kind: "none" };
      if (src?.button) return { ...buttonFace(family, src.button), family, kind: "button", source: id };
      return {
        label: src?.label ?? id,
        color: familyColor(family, src?.label ?? ""),
        family,
        kind: "button",
        source: id,
      };
    }
    const b = this.familyDefaults(family)[action]?.[0];
    if (!b) return { label: "-", color: "#5a5a64", family, kind: "none" };
    return { ...buttonFace(family, b), family, kind: "button" };
  }

  // ── Debug readout ──

  /** Raw per-device readout for a controller page: every button / axis value, trigger rest / threshold, notes. */
  debug(): DeviceDebug<A>[] {
    return this.deviceList().map((d) => ({
      handle: d.handle,
      key: d.key,
      name: d.name,
      family: d.family,
      profile: d.profile,
      kind: d.kind,
      seat: this.seats.indexOf(d.handle),
      custom: this.remaps.has(d.key),
      bindings: this.bindingsOf(d),
      defaults: d.defaults,
      held: { ...d.state.held },
      stick: [...d.stick] as [number, number, number, number],
      lt: d.lt,
      rt: d.rt,
      raw: d.raw,
      sources: [...d.sources.values()].map((s) => ({
        id: s.id,
        label: s.label,
        on: s.on,
        button: s.button,
        axis: s.axis,
        digital: s.trig.digital,
        analog: s.trig.analog,
        rest: s.trig.rest,
        peak: s.trig.peak,
        travel: s.trig.travel,
        threshold: s.trig.threshold(),
        analogTrigger: s.trig.isAnalog,
        note: s.trig.note,
        text: triggerText(s.trig),
      })),
    }));
  }

  /** The readout as text lines (a debug overlay). */
  debugText(): string {
    const lines: string[] = [];
    this.players.forEach((p, i) => lines.push(`P${i + 1}: ${p.connected ? `${p.name} (${p.profile})` : "-"}`));
    for (const d of this.debug()) {
      const head = `${d.handle} ${d.name} [${d.family}/${d.profile}]${d.custom ? " CUSTOM" : ""}`;
      lines.push(head);
      if (d.raw) {
        const axes = d.raw.axes.map((a, i) => `${i}:${a.toFixed(2)}`).join(" ");
        const btns = d.raw.buttons.flatMap((b, i) => (b.value > 0 ? [`${i}:${b.value.toFixed(2)}`] : [])).join(" ");
        lines.push(`  axes ${axes}  btns ${btns || "-"}`);
      }
      for (const s of d.sources)
        if (s.analogTrigger && !s.axis && s.analog !== undefined) lines.push(`  ${s.label}: ${s.text}`);
    }
    for (const p of this.opts.providers ?? []) {
      const t = p.debug?.();
      if (t) lines.push(t);
    }
    return lines.join("\n");
  }
}
