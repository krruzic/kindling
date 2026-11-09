# @kindling/input

Every couch input device as a `PadState` per seat, by the game's own action names: browser gamepads, GameCube
adapters, Switch 2 / Switch Pro pads over WebHID, keyboard halves and the mouse. On top of that: "press any button
to join" seats, per-device remaps with a guided "press every button" mode, prompt glyphs, menu navigation with key
repeat, a raw debug readout for a controller page, and stick helpers (deadzones, flicks, smashes, tap vs hold).

## Why

See [docs/LESSONS.md § Input](../../docs/LESSONS.md#input). In short:

- **Players bring odd hardware.** Mayflash GameCube adapters in PC mode, Linux uinput GameCube drivers, Switch 2
  pads that need a USB wake packet, a modded GameCube pad with a dead L click. Profiles for these are data
  (`BUILTIN_PROFILES`), and every input goes through `Trigger`: held when EITHER the click OR the analog travel says
  so, with hysteresis, a learned resting value and stuck-channel detection.
- **Remaps per device, never a trap.** Saved per Gamepad id / adapter port, applied again on reconnect. A guided
  remap can't lock out a player with one controller: hold any button to skip (or cancel), and it times out.
- **Prompts show the game's letters.** After a remap Grudge showed "BTN 11" in every footer and players hated it.
  `glyph()` returns the game's own label by default; physical labels only on request (e.g. a controller page);
  `mode: "auto"` shows the bound button's own face when it is a known button of that pad (CROSS on PlayStation)
  and falls back to the game's letter otherwise, which is what footers want.
- **A raw readout saves evenings.** When "my controller doesn't work", `debug()` shows every raw button / axis and
  each trigger's rest, threshold and ignored channel.

## API

| Export                                                                                 | What                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InputManager<A>`                                                                      | Polls devices (`poll(now?)`), seats (`players`, `join`, `release`, `move`, `seatMap`, `blocked`, `joining`, `onJoin` / `onLeave`), remaps (`bind`, `resetBindings`, `startRemap` / `cancelRemap`, `session`), `glyph(action, opts)`, `debug()` / `debugText()`, `devicePads()`, `lastDevice`. |
| `PadState<A>`                                                                          | `stickX/Y`, `cX/Y`, `lt` / `rt` travel, `held` / `pressed` / `released` by action, `family`, `name`, `pointer` (mouse half).                                                                                                                                                                  |
| `PadButton`, `PadFamily`                                                               | Canonical buttons by position (`south`, `east`, `lt`...) and families (`xbox`, `playstation`, `switch`, `gc`, `generic`, `keyboard`).                                                                                                                                                         |
| `KeyboardInput`, `attachDom`                                                           | Shared keyboard + mouse state; `attachDom(kb)` wires window events (browser).                                                                                                                                                                                                                 |
| `RemapStore`, `RemapSession`, `rebind`                                                 | Saved bindings via `load` / `save` callbacks; the capture session (`action`, `hold` 0..1, `step`, `status`); the swap rule.                                                                                                                                                                   |
| `MenuNavigator<A>`                                                                     | `read(pads, now, onlySeat?)` -> `{ dx, dy, confirm, back, seat, pressed }` with key repeat (`delay` 0.38 s, `every` 0.1 s); `readEach(pads, now)` gives each pad its own (a select screen with a cursor per seat).                                                                                                                                                                   |
| `Trigger`, `triggerText`                                                               | The either-channel trigger reader.                                                                                                                                                                                                                                                            |
| `Rumble`                 | `play(handle \| index, { strong, weak, ms })` dual-rumble on a browser pad (`vibrationActuator`); weaker pulses never cut a running one short; `scale` (0 = off), `stop()`.
| `detectFamily`, `buttonFace`, `keyLabel`, `cleanPadName`                               | Family from a Gamepad id; label / colour / shape per family; key names.                                                                                                                                                                                                                       |
| `profileFor`, `BUILTIN_PROFILES`, `Profile`                                            | Raw-gamepad layouts as data.                                                                                                                                                                                                                                                                  |
| `radialDeadzone`, `axialDeadzone`, `dir4`, `FlickDetector`, `SmashDetector`, `TapHold` | Stick helpers.                                                                                                                                                                                                                                                                                |
| `@kindling/input/hid`: `GcAdapter`, `ProCon2`, `ProCon2Waker`, `requestHidPads`        | WebHID / WebUSB readers, each a `PadProvider`; pure `GcAdapterDecoder` / `ProCon2Decoder` for tests.                                                                                                                                                                                          |

## Usage

```ts
import { attachDom, InputManager, MenuNavigator } from "@kindling/input";
import { GcAdapter, ProCon2, ProCon2Waker, requestHidPads } from "@kindling/input/hid";

type Action = "attack" | "jump" | "special" | "block" | "pause" | "up" | "down" | "left" | "right";

const gc = new GcAdapter();
const pro = new ProCon2();
new ProCon2Waker();

const input = new InputManager<Action>({
  actions: ["attack", "jump", "special", "block", "pause", "up", "down", "left", "right"],
  seats: 4,
  // Defaults per family, in canonical buttons (by position). Nintendo pads put "A" east.
  bindings: {
    default: {
      attack: ["south"],
      jump: ["north"],
      special: ["rt"],
      block: ["lt"],
      pause: ["start"],
      up: ["up"],
      down: ["down"],
      left: ["left"],
      right: ["right"],
    },
    switch: { attack: ["east"] },
    gc: { jump: ["east"] },
  },
  keyboards: [
    {
      stick: { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"] },
      buttons: { attack: ["KeyJ", "Mouse0"], jump: ["KeyK"], pause: ["Escape"] },
      mouse: true,
    },
    {
      stick: { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"] },
      buttons: { attack: ["Period"], jump: ["Comma"], pause: ["Enter"] },
    },
  ],
  providers: [gc, pro],
  remaps: {
    load: () => save.data.pads,
    save: (d) => {
      save.data.pads = d;
      save.write();
    },
  },
  labels: { attack: { label: "A", color: "#2f5fd8" }, jump: { label: "Y" } },
  triggerOn: { rt: 0.75 },
});
attachDom(input.keyboard);
findButton.onclick = () => requestHidPads(gc, pro); // WebHID needs a user gesture

const nav = new MenuNavigator<Action>({
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  confirm: ["attack", "pause"],
  back: ["jump"],
});

function frame() {
  input.poll();
  const menu = nav.read(input.players, performance.now() / 1000);
  for (const p of input.players)
    if (p.connected && p.pressed.attack) {
      /* ... */
    }
  drawPrompt(input.glyph("attack")); // { label: "A", color, family, kind: "game" } (or the key name on a keyboard)
}

// Controller setup page
const s = input.startRemap(deviceHandle, ["attack", "jump", "special", "block"]);
// each frame: draw s.action, s.hold (ring), s.step / s.steps.length, s.timeLeft(now); done when !s.active
```

Map a seat's `PadState` into your sim's command with your own `CommandMapper` (Grudge's lives in the game: it is
all game rules). `FlickDetector`, `SmashDetector` and `TapHold` are the reusable parts of it.

## How Grudge used it

Grudge (`src/input/*`) had one `Gamepads` class bound to its 13 GameCube-named buttons and its `data/input.json`
profiles; `app/nav.ts` did menu repeat; `ui/menus/padSetup.ts` drew CONTROLLER SETUP over `startCapture`. Here the
actions are a type parameter, profiles map to canonical buttons instead of Grudge's actions, defaults are per
family, the keyboard is N configurable halves (QUICKLORE's port), the navigator is a class, remaps persist through
callbacks, and every browser API (`navigator.getGamepads`, WebHID, WebUSB, window events) is injected so the whole
core runs under node with fake pads (`pnpm test`). Left in Grudge: the `CommandMapper` (build menus, charge,
reticles, MOBA mouse play), the pad diagrams and setup page drawing, and the keyboard-yields-to-pad rule for mouse
users.
